declare module "pagedjs" {
  export class Previewer {
    preview(content: string, stylesheets: unknown[], renderTo: HTMLElement): Promise<unknown>;
  }
}
