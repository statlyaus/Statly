import React from 'react';
import './globals.css'; // Make sure you have a globals.css file for Tailwind directives

export const metadata = {
  title: 'Statly - Fantasy AFL',
  description:
    'The ultimate fantasy sports platform for the Australian Football League.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white">{children}</body>
    </html>
  );
}