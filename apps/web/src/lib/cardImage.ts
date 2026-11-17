import { toJpeg } from 'html-to-image';

/**
 * Snapshots a DOM node (the share frame) to a base64 JPEG. WebKit sometimes paints an empty first
 * frame for foreignObject snapshots, so the picture is taken twice and the second one is used.
 */
export async function snapshotJpeg(node: HTMLElement): Promise<string> {
  const options = { quality: 0.9, pixelRatio: 1, backgroundColor: '#111318', cacheBust: false };
  await toJpeg(node, options).catch(() => undefined);
  const dataUrl = await toJpeg(node, options);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
