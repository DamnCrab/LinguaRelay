import type { SiteAdapter } from './contracts';
import { genericVideoSiteAdapter } from './generic-video-site';
import { localTestSiteAdapter } from './local-test-site';
import { youtubeSiteAdapter } from './youtube-site';

const ADAPTERS: SiteAdapter[] = [
  youtubeSiteAdapter,
  localTestSiteAdapter,
  genericVideoSiteAdapter,
].sort((a, b) => b.priority - a.priority);

export function resolveSiteAdapter(urlLike: string): SiteAdapter | null {
  let url: URL;
  try {
    url = new URL(urlLike);
  } catch {
    return null;
  }

  return ADAPTERS.find((adapter) => adapter.matches(url)) ?? null;
}

export function listSiteAdapters(): SiteAdapter[] {
  return [...ADAPTERS];
}
