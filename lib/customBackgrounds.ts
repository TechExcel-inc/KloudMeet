'use client';

/**
 * Your own camera background images. They stay on this device (IndexedDB), cropped to 16:9 at the
 * camera's size when added, the way the built-in scenes are shown. Nothing is uploaded: others
 * only see the image in your video. The processor reads them through object URLs.
 */

import React from 'react';

export type CustomBackgroundId = `custom:${string}`;

export const MAX_CUSTOM_BACKGROUNDS = 6;
/** Fired on window when images are added or removed (pre-join and meeting stay in step). */
export const CUSTOM_BACKGROUNDS_EVENT = 'kloudmeet:custom-backgrounds';

const DB_NAME = 'kloudmeet-backgrounds';
const STORE = 'images';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FULL = { width: 1280, height: 720 };
const THUMB = { width: 320, height: 180 };

interface StoredBackground {
  id: CustomBackgroundId;
  added: number;
  image: Blob;
  thumb: Blob;
}

export type AddBackgroundProblem = 'full' | 'type' | 'size' | 'unreadable' | 'storage';

export class AddBackgroundError extends Error {
  constructor(readonly problem: AddBackgroundProblem) {
    super(`Background image not added: ${problem}`);
  }
}

export function isCustomBackgroundId(value: unknown): value is CustomBackgroundId {
  return typeof value === 'string' && /^custom:[a-z0-9-]{6,40}$/.test(value);
}

/** The part of a w×h picture that fills a 16:9 frame, centred (what "cover" shows). */
export function coverCrop(width: number, height: number, aspect = 16 / 9) {
  if (width / height > aspect) {
    const sw = Math.round(height * aspect);
    return { sx: Math.round((width - sw) / 2), sy: 0, sw, sh: height };
  }
  const sh = Math.round(width / aspect);
  return { sx: 0, sy: Math.round((height - sh) / 2), sw: width, sh };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available'));
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  }).catch((error) => {
    dbPromise = undefined;
    throw error;
  });
  return dbPromise;
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

async function readAll(): Promise<StoredBackground[]> {
  try {
    const all = (await request((await store('readonly')).getAll())) as StoredBackground[];
    return all.filter((item) => isCustomBackgroundId(item.id)).sort((a, b) => b.added - a.added);
  } catch {
    return [];
  }
}

function announce() {
  window.dispatchEvent(new CustomEvent(CUSTOM_BACKGROUNDS_EVENT));
}

async function encode(bitmap: ImageBitmap, size: { width: number; height: number }): Promise<Blob> {
  const { sx, sy, sw, sh } = coverCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AddBackgroundError('unreadable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!blob) throw new AddBackgroundError('unreadable');
  return blob;
}

function newId(): CustomBackgroundId {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `custom:${random.toLowerCase()}`;
}

/** Adds a picture the person chose; it comes back newest first in the list. */
export async function addCustomBackground(file: File): Promise<CustomBackgroundId> {
  if ((await readAll()).length >= MAX_CUSTOM_BACKGROUNDS) throw new AddBackgroundError('full');
  if (!/^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(file.type)) throw new AddBackgroundError('type');
  if (file.size > MAX_FILE_BYTES) throw new AddBackgroundError('size');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new AddBackgroundError('unreadable');
  }
  try {
    const [image, thumb] = [await encode(bitmap, FULL), await encode(bitmap, THUMB)];
    const item: StoredBackground = { id: newId(), added: Date.now(), image, thumb };
    try {
      await request((await store('readwrite')).put(item));
    } catch {
      throw new AddBackgroundError('storage');
    }
    announce();
    return item.id;
  } finally {
    bitmap.close();
  }
}

const imageUrls = new Map<CustomBackgroundId, string>();

export async function removeCustomBackground(id: CustomBackgroundId): Promise<void> {
  try {
    await request((await store('readwrite')).delete(id));
  } finally {
    const url = imageUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    imageUrls.delete(id);
    announce();
  }
}

/** The full-size image for the processor, or undefined when it's gone (removed, storage cleared). */
export async function customBackgroundUrl(id: CustomBackgroundId): Promise<string | undefined> {
  const cached = imageUrls.get(id);
  if (cached) return cached;
  try {
    const item = (await request((await store('readonly')).get(id))) as StoredBackground | undefined;
    if (!item) return undefined;
    const url = URL.createObjectURL(item.image);
    imageUrls.set(id, url);
    return url;
  } catch {
    return undefined;
  }
}

export interface CustomBackgroundTile {
  id: CustomBackgroundId;
  thumbUrl: string;
}

/** The person's images for the picker, newest first, kept in step across the page. */
export function useCustomBackgrounds(enabled: boolean): CustomBackgroundTile[] {
  const [tiles, setTiles] = React.useState<CustomBackgroundTile[]>([]);
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let current: CustomBackgroundTile[] = [];
    const load = async () => {
      const items = await readAll();
      if (!alive) return;
      const next = items.map((item) => ({ id: item.id, thumbUrl: URL.createObjectURL(item.thumb) }));
      current.forEach((tile) => URL.revokeObjectURL(tile.thumbUrl));
      current = next;
      setTiles(next);
    };
    void load();
    window.addEventListener(CUSTOM_BACKGROUNDS_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(CUSTOM_BACKGROUNDS_EVENT, load);
      current.forEach((tile) => URL.revokeObjectURL(tile.thumbUrl));
    };
  }, [enabled]);
  return tiles;
}
