import "./globals.css";

export const metadata = {
  title: "Ryder Schilling — Client Dashboard",
  description: "Client, project, payment and referral tracker",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
