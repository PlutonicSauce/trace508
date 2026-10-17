import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Trace508 · Accessibility evidence workspace',
  description:
    'Evidence-first WCAG 2.0 and Section 508 assessment, human review and draft reporting.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
