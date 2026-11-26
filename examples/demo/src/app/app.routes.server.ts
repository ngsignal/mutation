import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Every page is pre-rendered at build time: GitHub Pages serves each one as a real HTML file,
 * with a 200 status and its content, title and description already in the markup.
 */
export const serverRoutes: ServerRoute[] = [{ path: '**', renderMode: RenderMode.Prerender }];
