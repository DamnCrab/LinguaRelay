import { defineContentScript } from 'wxt/utils/define-content-script';
import { YouTubeLiveController } from '../content/youtube/live-controller';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    const controller = new YouTubeLiveController();
    controller.start();

    const cleanup = () => {
      void controller.dispose('content_cleanup');
    };

    window.addEventListener('beforeunload', cleanup, { once: true });
  },
});

