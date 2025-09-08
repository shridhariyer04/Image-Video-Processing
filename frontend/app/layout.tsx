import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Image Processor',
  description: 'Advanced image processing application',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}