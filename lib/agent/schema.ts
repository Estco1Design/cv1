import { z } from "zod";
export const intentSchema = z.object({
  sourceHandle: z.string().regex(/^[a-zA-Z0-9._]{1,30}$/),
  city: z.string().min(1).max(100).default("Москва"),
  targetCount: z.number().int().min(1).max(200).default(30),
  maxProfiles: z.number().int().min(1).max(2000).default(300),
  excludedCategories: z.array(z.string().max(100)).max(20).default([]),
  offerInstructions: z.string().max(2000).default(""),
  outreachMode: z.enum(["draft", "approval"]).default("approval"),
  parsedBy: z.enum(["llm", "local_rules"]).default("llm"),
});
export type TaskIntent = z.infer<typeof intentSchema>;
export const postSchema = z.object({
  caption: z.string().max(12000).default(""),
  publishedAt: z.string().optional(),
  imageUrl: z.string().url().optional(),
  url: z.string().url().optional(),
  location: z.string().optional(),
});
export type RecentPost = z.infer<typeof postSchema>;
export const followersSchema = z.object({
  handles: z.array(z.string().regex(/^[a-zA-Z0-9._]{1,30}$/)).max(200),
  nextCursor: z.string().max(200000).nullable(),
  hasMore: z.boolean(),
  limitation: z.string().max(1000).optional(),
});
export type FollowerPage = z.infer<typeof followersSchema>;
export interface InstagramSource {
  name: string;
  getFollowers(
    handle: string,
    cursor: string | null,
    limit: number,
  ): Promise<FollowerPage>;
  fetchProfile(handle: string): Promise<import("../providers").Profile>;
  fetchRecentPosts(
    handle: string,
    profile: import("../providers").Profile,
  ): Promise<RecentPost[]>;
  close?(): Promise<void>;
}
export class SourceBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceBlocked";
  }
}
