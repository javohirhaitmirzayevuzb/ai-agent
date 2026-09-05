import './globals.css';
import { AppProvider } from '@/components/session';

export const metadata = {
  title: 'Studio — AI cover & post generator',
  description:
    'Login with your name and surname, drop in a reference cover or post, let the studio read its design DNA, then regenerate a stylish new one from your own brief.',
  applicationName: 'Studio',
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }] },
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#06080f' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
