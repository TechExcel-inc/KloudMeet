import { Suspense } from 'react';
import { TvRoom } from './TvRoom';
import '@/styles/tvRoom.css';

/** A meeting on Kloud Meet TV: pre-join, waiting, then the meeting with the TV's controls. */
export default async function TvRoomPage({ params }: { params: Promise<{ roomName: string }> }) {
  const { roomName } = await params;
  return (
    <Suspense fallback={null}>
      <TvRoom roomName={roomName} />
    </Suspense>
  );
}
