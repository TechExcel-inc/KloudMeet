import type { MetadataRoute } from 'next';

/** Meeting rooms, chat logs and APIs are private links and must not be indexed. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/rooms/', '/meeting/', '/custom'],
    },
  };
}
