import { GenericVideoController } from '../generic/generic-video-controller';
import type { SiteAdapter } from './contracts';

export const genericVideoSiteAdapter: SiteAdapter = {
  id: 'generic-video',
  priority: 10,
  isOptimized: false,
  matches(url) {
    return ['http:', 'https:'].includes(url.protocol);
  },
  create() {
    const siteId = `site:${location.hostname.toLowerCase()}`;
    return new GenericVideoController(siteId);
  },
};
