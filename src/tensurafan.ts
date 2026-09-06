import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as loadCheerio, CheerioAPI } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

type Volume = {
  id: string;
  name: string;
  path: string;
};

class TensuraFanPlugin implements Plugin.PluginBase {
  id = 'tensurafan';
  name = 'TensuraFan Slime Reader';
  icon = 'https://tensurafan.github.io/icons/android-icon-192x192.png';
  site = 'https://tensurafan.github.io';
  version = '1.0.0';

  private async getVolumes(): Promise<Volume[]> {
    const result = await fetchApi(`${this.site}/ln/volumes.json`);

    if (!result.ok) {
      throw new Error('Could not load TensuraFan volume list');
    }

    return (await result.json()) as Volume[];
  }

  private async loadVolume(path: string): Promise<CheerioAPI> {
    const result = await fetchApi(this.site + path);

    if (!result.ok) {
      throw new Error(`Could not load volume: ${path}`);
    }

    return loadCheerio(await result.text());
  }

  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\{\{.*?\}\}/g, '')
      .trim();
  }

  private getChapterLinks($: CheerioAPI): Array<{
    name: string;
    anchor: string;
  }> {
    const chapters: Array<{ name: string; anchor: string }> = [];

    $('a.hlink[href*="#"]').each((_, element) => {
      const href = $(element).attr('href') || '';

      const hash = href.indexOf('#');
      if (hash === -1) return;

      const anchor = href.slice(hash + 1);

      if (!anchor || anchor === 'manga' || anchor === 'afterword') {
        return;
      }

      const name = this.cleanText($(element).text());

      if (!name) return;

      chapters.push({
        name,
        anchor,
      });
    });

    return chapters;
  }

  async popularNovels(
    pageNo: number,
    _options: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    const volumes = await this.getVolumes();

    return volumes.map(volume => ({
      name: volume.name,
      path: volume.path,
      cover: defaultCover,
    }));
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    const query = searchTerm.toLowerCase().trim();

    const volumes = await this.getVolumes();

    if (!query) {
      return volumes.map(volume => ({
        name: volume.name,
        path: volume.path,
        cover: defaultCover,
      }));
    }

    return volumes
      .filter(volume =>
        volume.name.toLowerCase().includes(query)
      )
      .map(volume => ({
        name: volume.name,
        path: volume.path,
        cover: defaultCover,
      }));
  }

  async parseNovel(
    novelPath: string,
  ): Promise<Plugin.SourceNovel> {
    const $ = await this.loadVolume(novelPath);

    const volumeName =
      $('title').first().text().trim() ||
      novelPath
        .split('/')
        .pop()
        ?.replace('.html', '') ||
      'TensuraFan Volume';

    const chapterLinks = this.getChapterLinks($);

    const chapters = chapterLinks.map((chapter, index) => ({
      name: chapter.name,
      path: `${novelPath}?chapter=${encodeURIComponent(chapter.anchor)}`,
      chapterNumber: index + 1,
    }));

    return {
      path: novelPath,
      name: volumeName,
      author: 'Fuse',
      genres: 'Light Novel, Fantasy',
      status: NovelStatus.Completed,
      summary:
        'Fan translation of That Time I Got Reincarnated as a Slime (Tensura), hosted by TensuraFan.',
      cover: defaultCover,
      chapters,
    };
  }

  async parseChapter(
    chapterPath: string,
  ): Promise<string> {
    const questionMark = chapterPath.indexOf('?');

    const volumePath =
      questionMark >= 0
        ? chapterPath.slice(0, questionMark)
        : chapterPath;

    const query =
      questionMark >= 0
        ? chapterPath.slice(questionMark + 1)
        : '';

    const params = new URLSearchParams(query);
    const anchor = params.get('chapter');

    if (!anchor) {
      throw new Error('Chapter identifier missing');
    }

    const $ = await this.loadVolume(volumePath);

    const marker = $(`#${anchor}`).first();

    if (!marker.length) {
      throw new Error(`Chapter marker not found: ${anchor}`);
    }

    let start: any = null;

    let current: any = marker.get(0);

    while (current) {
      if (
        current.type === 'tag' &&
        current.name?.toLowerCase() === 'h1' &&
        $(current).hasClass('ch-number')
      ) {
        start = current;
        break;
      }

      current = current.nextSibling;
    }

    if (!start) {
      throw new Error(`Chapter heading not found: ${anchor}`);
    }

    const pieces: string[] = [];

    current = start;

    while (current) {
      if (current !== start && current.type === 'tag') {
        const tag = current.name?.toLowerCase();

        if (
          tag === 'h1' &&
          $(current).hasClass('ch-number')
        ) {
          break;
        }
      }

      if (current.type === 'tag') {
        const tag = current.name?.toLowerCase();

        if (
          tag === 'script' ||
          tag === 'style' ||
          tag === 'nav'
        ) {
          current = current.nextSibling;
          continue;
        }

        pieces.push($.html(current));
      }

      current = current.nextSibling;
    }

    const content = pieces.join('\n').trim();

    if (!content) {
      throw new Error(`No content found for chapter: ${anchor}`);
    }

    return content;
  }

  resolveUrl = (path: string) => {
    if (path.startsWith('http')) {
      return path;
    }

    return this.site + path;
  };
}

export default new TensuraFanPlugin();
