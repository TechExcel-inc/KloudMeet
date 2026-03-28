import { PrismaClient } from '@prisma/client';
import 'dotenv/config'; // ensure env vars are loaded
import { EgressClient } from 'livekit-server-sdk';

const prisma = new PrismaClient();
const egressClient = new EgressClient(
  process.env.LIVEKIT_URL || '', 
  process.env.LIVEKIT_API_KEY || '', 
  process.env.LIVEKIT_API_SECRET || ''
);

async function main() {
  const recs = await prisma.recording.findMany({
    orderBy: { createdAt: 'desc' },
    take: 1
  });
  console.log("=== Recent Recording ===");
  for (const r of recs) {
    console.log(`ID: ${r.id} | Status: ${r.status} | Key: ${r.storageKey}`);
    const egresses = await egressClient.listEgress({ egressId: r.storageKey });
    if (egresses.length > 0) {
      console.dir(egresses[0], { depth: null });
    } else {
      console.log('No egress details found in LiveKit');
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
