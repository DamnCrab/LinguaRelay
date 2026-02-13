import { LocalAudioTestController } from '../testing/local-audio-test-controller';
import type { SiteAdapter } from './contracts';

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1)$/i;

export const localTestSiteAdapter: SiteAdapter = {
  id: 'local-test',
  priority: 90,
  isOptimized: true,
  matches(url) {
    if (!LOCAL_HOST_PATTERN.test(url.hostname)) {
      return false;
    }

    if (url.pathname === '/local-audio-test.html') {
      return true;
    }

    return url.searchParams.get('linguarelayTest') === '1';
  },
  create() {
    return new LocalAudioTestController();
  },
};
