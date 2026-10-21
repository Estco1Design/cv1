import { z } from "zod";
import { analyze, completion, generate, evaluate } from "../ai";
import { Profile } from "../providers";
import { TaskIntent, InstagramSource, RecentPost } from "./schema";
import { queueMessage } from "./queue";
export type Evidence = {
  id: string;
  kind: "bio" | "business_city" | "post";
  quote: string;
  url: string;
  date?: string;
};
export function evidenceFor(profile: Profile, posts: RecentPost[]): Evidence[] {
  const url = "https://www.instagram.com/" + profile.username + "/";
  const result: Evidence[] = [];
  if (profile.bio)
    result.push({ id: "bio", kind: "bio", quote: profile.bio, url });
  if (profile.city)
    result.push({
      id: "business_city",
      kind: "business_city",
      quote: profile.city,
      url,
    });
  posts.forEach((p, i) => {
    if (p.caption || p.location)
      result.push({
        id: "post:" + i,
        kind: "post",
        quote: [p.caption, p.location].filter(Boolean).join("\n"),
        url: p.url || url,
        date: p.publishedAt,
      });
  });
  return result;
}
const verdictSchema = z.object({
  commercial: z.boolean(),
  clientType: z.string(),
  location: z.object({
    status: z.enum(["confirmed", "uncertain", "outside"]),
    evidenceIds: z.array(z.string()),
    reason: z.string(),
  }),
  observations: z.array(
    z.object({ evidenceId: z.string(), quote: z.string().min(1).max(12000) }),
  ),
  rationale: z.string(),
});
export function verifiedLocation(
  verdict: z.infer<typeof verdictSchema>["location"],
  evidence: Evidence[],
  city: string,
) {
  const cited = evidence.filter((e) => verdict.evidenceIds.includes(e.id));
  const pattern = /москв|moscow/i.test(city)
    ? /москв|moscow/i
    : new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const supporting = cited
    .filter((e) => pattern.test(e.quote.replace(/#[^\s#]+/g, "")))
    .filter(
      (e) =>
        !/(доставк|shipping|ship to|доставка)/i.test(e.quote) ||
        /(based in|находимся|адрес|шоурум|студия|📍)\s*[^\n]{0,35}(москв|moscow)/i.test(
          e.quote,
        ),
    );
  const located = supporting.filter((e) => {
    if (e.kind === "business_city") return true;
    if (!/москв|moscow/i.test(city)) return e.kind === "bio";
    const text = e.quote.replace(/#[^\s#]+/g, "");
    if (/(?:not based in|не в|не находимся в)\s*(?:москв|moscow)/i.test(text))
      return false;
    return (
      /(?:based in|находимся в|расположен[^\n]{0,12}|адрес[: ]*|наш[^\n]{0,12}шоурум|наш[^\n]{0,12}студи|студия в|бренд из|дизайнер из|📍)\s*[^\n]{0,25}(?:москв|moscow)/i.test(
        text,
      ) ||
      (e.kind === "bio" &&
        /(?:^|[\n|•])\s*(?:г\.?\s*)?(?:москва|moscow)(?:$|[\s|•,])/i.test(text))
    );
  });
  const confirmed = verdict.status === "confirmed" && located.length > 0;
  return {
    status: confirmed
      ? "confirmed"
      : verdict.status === "outside" && cited.length
        ? "outside"
        : "uncertain",
    confidence: confirmed ? "medium" : "low",
    evidence: confirmed ? located : cited,
    reason:
      verdict.status === "confirmed" && !confirmed
        ? "Локация не подтверждена проверяемыми сведениями. AI-вывод отклонён. " +
          verdict.reason
        : verdict.reason,
  };
}
export function isAgency(profile: Profile, clientType = "") {
  return /агентств|\bagenc(?:y|ies)\b/i.test(
    [profile.bio, profile.category, profile.name, clientType].join(" "),
  );
}
export async function analyzeCandidate(
  profile: Profile,
  posts: RecentPost[],
  intent: TaskIntent,
) {
  const evidence = evidenceFor(profile, posts);
  const verdict = verdictSchema.parse(
    await completion(
      'Assess candidate for Alexander Hideki fashion photography. Return JSON {commercial:boolean,clientType:string,location:{status:"confirmed"|"uncertain"|"outside",evidenceIds:string[],reason:string},observations:[{evidenceId:string,quote:string}],rationale:string}. Cite ONLY supplied evidence ids; observations quote must be exact substring. Confirm target city ONLY when public evidence establishes actual location, NOT delivery coverage, hashtags alone, audience, guesses or photographer location. Unknown city is uncertain. Personal non-commercial accounts are not prospects. Do not claim images viewed; this stage receives TEXT only.',
      {
        targetCity: intent.city,
        profile: { ...profile, posts: [] },
        evidence,
        excludedCategories: intent.excludedCategories,
      },
    ),
  );
  const location = verifiedLocation(verdict.location, evidence, intent.city);
  const observations = verdict.observations
    .filter((o) =>
      evidence.some((e) => e.id === o.evidenceId && e.quote.includes(o.quote)),
    )
    .map((o) => ({
      ...o,
      source: evidence.find((e) => e.id === o.evidenceId),
    }));
  const assessment = await analyze({ ...profile, posts });
  return {
    ...assessment,
    facts: evidence.map((e) => e.quote),
    commercial: verdict.commercial,
    clientType: verdict.clientType,
    location,
    observations,
    rationale: verdict.rationale,
    evidenceCatalog: evidence,
  };
}
export type CandidateAssessment = Awaited<ReturnType<typeof analyzeCandidate>>;
export interface AgentTools {
  getFollowers: InstagramSource["getFollowers"];
  fetchProfile: InstagramSource["fetchProfile"];
  fetchRecentPosts: InstagramSource["fetchRecentPosts"];
  analyzeCandidate: typeof analyzeCandidate;
  draftOffers: (
    profile: Profile,
    assessment: unknown,
    intent: TaskIntent,
  ) => ReturnType<typeof generate>;
  selectOffer: (offers: unknown) => ReturnType<typeof evaluate>;
  queueMessage: typeof queueMessage;
  sendViaProvider: (messageId: string) => Promise<void>;
}
export function toolsFor(source: InstagramSource): AgentTools {
  return {
    getFollowers: source.getFollowers.bind(source),
    fetchProfile: source.fetchProfile.bind(source),
    fetchRecentPosts: source.fetchRecentPosts.bind(source),
    analyzeCandidate,
    draftOffers: async (profile, assessment, intent) => {
      const generated = await generate(
        profile,
        {
          assessment,
          operatorInstructions: intent.offerInstructions,
          targetCity: intent.city,
        },
        false,
        intent.offerInstructions,
      );
      if (
        /без вопросов|не используй вопросы|no questions/i.test(
          intent.offerInstructions,
        ) &&
        generated.offers.some((o) => o.body.includes("?"))
      )
        throw new Error(
          "AI нарушил требование «без вопросов». Перегенерируйте; текст не поставлен в очередь.",
        );
      return generated;
    },
    selectOffer: (offers) => evaluate(offers),
    queueMessage,
    sendViaProvider: async (messageId) => {
      const { dispatch } = await import("../worker");
      return dispatch(messageId);
    },
  };
}
