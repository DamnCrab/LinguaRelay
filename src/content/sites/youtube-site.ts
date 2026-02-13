import { YOUTUBE_HOST_PATTERN } from '../../shared/constants';
import { YouTubeLiveController } from '../youtube/live-controller';
import type { SiteAdapter } from './contracts';

export const youtubeSiteAdapter: SiteAdapter = {
  id: 'youtube',
  priority: 100,
  isOptimized: true,
  matches(url) {
    return YOUTUBE_HOST_PATTERN.test(url.hostname);
  },
  create() {
    return new YouTubeLiveController();
  },
};
