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

type ChapterInfo = {
  name: string;
  anchor: string;
};

class TensuraFanPlugin implements Plugin.PluginBase {
  id = 'tensurafan';
  name = 'TensuraFan Slime Reader';
  icon =
    'https://tensurafan.github.io/icons/android-icon-192x192.png';
  site = 'https://tensurafan.github.io';
  version = '1.0.3';
  filters = {};

  private async getVolumes(): Promise<Volume[]> {
    const result = await fetchApi(
      `${this.site}/ln/volumes.json`,
    );

    if (!result.ok) {
      throw new Error(
        'Could not load TensuraFan volume list',
      );
    }

    return (await result.json()) as Volume[];
  }

  private async loadVolume(
    path: string,
  ): Promise<CheerioAPI> {
    const result = await fetchApi(this.site + path);

    if (!result.ok) {
      throw new Error(
        `Could not load volume: ${path}`,
      );
    }

    const $ = loadCheerio(await result.text());

    /*
     * TensuraFan uses JavaScript-powered clickable terms.
     *
     * In some environments the site's template code appears
     * literally as text, such as:
     *
     * {this.app...}
     *
     * Every one of these terms has a data-term attribute
     * containing the actual text that should be displayed.
     *
     * Replace the contents with data-term so LNReader gets
     * the real words instead of TensuraFan's template code.
     */
    $('[data-term]').each((_, element) => {
      const term = $(element).attr('data-term');

      if (term) {
        $(element).text(term);
      }

      $(element).removeAttr('onclick');
    });

    /*
     * Remove JavaScript handlers. LNReader only needs the
     * readable content.
     */
    $('[onclick]').removeAttr('onclick');

    /*
     * Scripts aren't needed in LNReader and can contain
     * TensuraFan's application/template code.
     */
    $('script').remove();

    return $;
  }

  private cleanText(text: string): string {
    return text
      .replace(
        /\{[^{}]*(?:this\.app|allTermsChosen)[^{}]*\}/gi,
        '',
      )
      .replace(/\s+/g, ' ')
      .replace(/\s+([,:;.!?])/g, '$1')
      .trim();
  }

  private getChapters(
    $: CheerioAPI,
  ): ChapterInfo[] {
    const chapters: ChapterInfo[] = [];
    const seen = new Set<string>();

    $('a.hlink[href*="#"]').each((_, element) => {
      const href = $(element).attr('href') || '';
      const hashIndex = href.indexOf('#');

      if (hashIndex === -1) {
        return;
      }

      const anchor = href
        .slice(hashIndex + 1)
        .trim()
        .toLowerCase();

      if (!anchor) {
        return;
      }

      /*
       * Manga isn't a normal text chapter.
       * Afterword is excluded for now because the normal
       * chapter headings end before it.
       */
      if (
        anchor === 'manga' ||
        anchor === 'afterword'
      ) {
        return;
      }

      if (seen.has(anchor)) {
        return;
      }

      seen.add(anchor);

      let name = this.cleanText(
        $(element).text(),
      );

      /*
       * Safety fallback if a live TensuraFan page still
       * contains template garbage in its TOC.
       *
       * We reconstruct the title from the matching
       * chapter headings.
       */
      if (
        !name ||
        name.includes('this.app') ||
        name.includes('allTermsChosen') ||
        name.includes('{') ||
        name.includes('}')
      ) {
        const chapterIndex = chapters.length;

        const numberHeading = $('h1.ch-number')
          .eq(chapterIndex)
          .text();

        const nameHeading = $('h1.ch-number')
          .eq(chapterIndex)
          .nextAll('h1.ch-name')
          .first()
          .text();

        const number = this.cleanText(
          numberHeading,
        );

        const chapterName = this.cleanText(
          nameHeading,
        );

        if (number && chapterName) {
          name = `${number}: ${chapterName}`;
        } else if (number) {
          name = number;
        }
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
    _options: Plugin.PopularNovelsOptions<
      typeof this.filters
    >,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) {
      return [];
    }

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
    if (pageNo > 1) {
      return [];
    }

    const query = searchTerm
      .toLowerCase()
      .trim();

    const volumes = await this.getVolumes();

    return volumes
      .filter(
        volume =>
          !query ||
          volume.name
            .toLowerCase()
            .includes(query),
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
    const $ = await this.loadVolume(
      novelPath,
    );

    const volumeName =
      this.cleanText(
        $('title').first().text(),
      ) ||
      novelPath
        .split('/')
        .pop()
        ?.replace('.html', '') ||
      'TensuraFan Volume';

    const chapterList =
      this.getChapters($);

    /*
     * LNReader itself uses paths such as:
     *
     * /ln/v6.html#0
     * /ln/v6.html#1
     *
     * So we intentionally use that format.
     */
    const chapters = chapterList.map(
      (chapter, index) => ({
        name: chapter.name,
        path: `${novelPath}#${index}`,
        chapterNumber: index + 1,
      }),
    );

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
    /*
     * LNReader passes:
     *
     * /ln/v6.html#0
     *
     * where 0 is Prologue,
     * 1 is Chapter 1, etc.
     */
    const hashIndex =
      chapterPath.lastIndexOf('#');

    if (hashIndex === -1) {
      throw new Error(
        `Invalid TensuraFan chapter path: ${chapterPath}`,
      );
    }

    const volumePath =
      chapterPath.slice(0, hashIndex);

    const chapterIndex = Number(
      chapterPath.slice(hashIndex + 1),
    );

    if (
      !Number.isInteger(chapterIndex) ||
      chapterIndex < 0
    ) {
      throw new Error(
        `Invalid chapter number: ${chapterPath}`,
      );
    }

    const $ = await this.loadVolume(
      volumePath,
    );

    /*
     * Much more reliable than navigating from the
     * #prologue/#chapter-1 image marker.
     *
     * Those IDs can be inside another <div>, meaning
     * nextSibling cannot reach the chapter heading.
     *
     * Instead, directly select the chapter headings.
     */
    const chapterStarts =
      $('h1.ch-number').toArray();

    const start =
      chapterStarts[chapterIndex];

    if (!start) {
      throw new Error(
        `Chapter ${chapterIndex} was not found`,
      );
    }

    const pieces: string[] = [];

    let current: any = start;

    while (current) {
      if (
        current !== start &&
        current.type === 'tag'
      ) {
        const tag =
          current.name?.toLowerCase();

        const id = (
          $(current).attr('id') || ''
        ).toLowerCase();

        /*
         * Beginning of the next normal chapter.
         */
        if (
          tag === 'h1' &&
          $(current).hasClass(
            'ch-number',
          )
        ) {
          break;
        }

        /*
         * Stop Epilogue before Manga / Afterword.
         */
        if (
          id === 'manga' ||
          id === 'afterword' ||
          (tag === 'h1' &&
            $(current).hasClass(
              'afterword',
            ))
        ) {
          break;
        }
      }

      if (current.type === 'tag') {
        const tag =
          current.name?.toLowerCase();

        if (
          tag !== 'script' &&
          tag !== 'style' &&
          tag !== 'nav'
        ) {
          pieces.push(
            $.html(current),
          );
        }
      }

      current = current.nextSibling;
    }

    let content = pieces
      .join('\n')
      .trim();

    /*
     * Last-resort cleanup for any raw template expressions
     * that aren't contained inside a data-term element.
     */
    content = content
      .replace(
        /\{[^{}]*(?:this\.app|allTermsChosen)[^{}]*\}/gi,
        '',
      )
      .trim();

    if (!content) {
      throw new Error(
        `No readable content found for chapter ${chapterIndex}`,
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

    if (path.startsWith('/')) {
      return this.site + path;
    }

    return `${this.site}/${path.replace(
      /^\.\//,
      '',
    )}`;
  };
}

export default new TensuraFanPlugin();
