import { Suspense } from 'react';
import { TvHome } from './TvHome';

/** Kloud Meet TV: open meet.kloud.cn/tv on a TV browser (or the TV app's WebView). */
export default function TvPage() {
  return (
    <Suspense fallback={null}>
      <TvHome />
    </Suspense>
  );
}
