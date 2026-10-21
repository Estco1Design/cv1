import "./globals.css";
export const metadata = {
  title: "HIDEKI / SALES INTELLIGENCE",
  description: "Fashion outreach workspace",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
