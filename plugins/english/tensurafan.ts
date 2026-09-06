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
  version = '1.0.2';
  filters = {};

  private chapterSeparator = '/__chapter__/';

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
      .replace(/\{\{.*?\}\}/g, '')
      .replace(/\{[^{}]*this\.[^{}]*\}/g, '')
      .replace(/\{[^{}]*\}/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.:;!?])/g, '$1')
      .trim();
  }

  private fallbackChapterName(anchor: string): string {
    if (anchor === 'prologue') return 'Prologue';
    if (anchor === 'interlude') return 'Interlude';
    if (anchor === 'epilogue') return 'Epilogue';

    const chapterMatch = anchor.match(/^chapter-(\d+)$/);

    if (chapterMatch) {
      return `Chapter ${chapterMatch[1]}`;
    }

    return anchor
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private getChapterLinks($: CheerioAPI): Array<{
    name: string;
    anchor: string;
  }> {
    const chapters: Array<{
      name: string;
      anchor: string;
    }> = [];

    const seen = new Set<string>();

    $('a.hlink[href*="#"]').each((_, element) => {
      const href = $(element).attr('href') || '';

      const hashIndex = href.indexOf('#');

      if (hashIndex === -1) return;

      const anchor = href
        .slice(hashIndex + 1)
        .trim()
        .toLowerCase();

      if (!anchor) return;

      if (anchor === 'manga' || anchor === 'afterword') {
        return;
      }

      if (seen.has(anchor)) {
        return;
      }

      seen.add(anchor);

      let name = this.cleanText($(element).text());

      if (
        !name ||
        name.includes('{') ||
        name.includes('}') ||
        name.includes('this.')
      ) {
        name = this.fallbackChapterName(anchor);
      }

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
        volume.name.toLowerCase().includes(query),
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
      path:
        novelPath +
        this.chapterSeparator +
        encodeURIComponent(chapter.anchor),
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
    const separatorIndex = chapterPath.indexOf(
      this.chapterSeparator,
    );

    if (separatorIndex === -1) {
      throw new Error(
        `Invalid TensuraFan chapter path: ${chapterPath}`,
      );
    }

    const volumePath = chapterPath.slice(0, separatorIndex);

    const anchor = decodeURIComponent(
      chapterPath.slice(
        separatorIndex + this.chapterSeparator.length,
      ),
    );

    if (!anchor) {
      throw new Error('Chapter identifier missing');
    }

    const $ = await this.loadVolume(volumePath);

    const marker = $(`[id="${anchor}"]`).first();

    if (!marker.length) {
      throw new Error(
        `Chapter marker not found: ${anchor}`,
      );
    }

    let current: any = marker.get(0);
    let start: any = null;

    while (current) {
      if (current.type === 'tag') {
        const tag = current.name?.toLowerCase();

        if (
          tag === 'h1' &&
          $(current).hasClass('ch-number')
        ) {
          start = current;
          break;
        }
      }

      current = current.nextSibling;
    }

    if (!start) {
      throw new Error(
        `Chapter heading not found: ${anchor}`,
      );
    }

    const pieces: string[] = [];

    current = start;

    while (current) {
      if (current !== start && current.type === 'tag') {
        const tag = current.name?.toLowerCase();
        const id = ($(current).attr('id') || '').toLowerCase();

        if (
          (tag === 'h1' &&
            $(current).hasClass('ch-number')) ||
          id === 'manga' ||
          id === 'afterword' ||
          (tag === 'h1' &&
            $(current).hasClass('afterword'))
        ) {
          break;
        }
      }

      if (current.type === 'tag') {
        const tag = current.name?.toLowerCase();

        if (
          tag !== 'script' &&
          tag !== 'style' &&
          tag !== 'nav'
        ) {
          pieces.push($.html(current));
        }
      }

      current = current.nextSibling;
    }

    const content = pieces.join('\n').trim();

    if (!content) {
      throw new Error(
        `No readable content found for chapter: ${anchor}`,
      );
    }

    return content;
  }

  resolveUrl = (path: string) => {
    if (path.startsWith('http')) {
      return path;
    }

    if (path.startsWith('//')) {
      return 'https:' + path;
    }

    return this.site + path;
  };
}

export default new TensuraFanPlugin();
