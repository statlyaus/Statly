import { permanentRedirect } from 'next/navigation';

// Legacy page disabled; redirect to /leagues overview
export default function Page() {
  permanentRedirect('/leagues');
}
