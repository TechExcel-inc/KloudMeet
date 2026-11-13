import { redirect } from 'next/navigation';

// The TV runs the Kloud Meet TV app; on the web, /tv is the phone remote.
export default function TvIndex() {
  redirect('/tv/remote');
}
