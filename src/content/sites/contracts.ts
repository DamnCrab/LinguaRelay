export interface SiteController {
  start(): void;
  dispose(reason?: string): Promise<void>;
}

export interface SiteAdapter {
  id: string;
  priority: number;
  isOptimized: boolean;
  matches(url: URL): boolean;
  create(): SiteController;
}
