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

type SeriesChapter = {
  volume: Volume;
  chapter: ChapterInfo;
  localIndex: number;
};

class TensuraFanPlugin implements Plugin.PluginBase {
  id = 'tensurafan';
  name = 'TensuraFan Slime Reader';
  icon =
    'https://tensurafan.github.io/icons/android-icon-192x192.png';
  site = 'https://tensurafan.github.io';
  version = '1.0.4';
  filters = {};

  private seriesPath = '/series/tensura';

  private seriesName =
    'That Time I Got Reincarnated as a Slime [Combined]';

  private async getVolumes(): Promise<Volume[]> {
    const result = await fetchApi(
      `${this.site}/ln/volumes.json`,
    );

    if (!result.ok) {
      throw new Error(
        'Could not load TensuraFan volume list',
      );
    }

    const volumes =
      (await result.json()) as Volume[];

    const seen = new Set<string>();

    return volumes.filter(volume => {
      if (seen.has(volume.path)) {
        return false;
      }

      seen.add(volume.path);

      return true;
    });
  }

  private async loadVolume(
    path: string,
  ): Promise<CheerioAPI> {
    const result = await fetchApi(
      this.site + path,
    );

    if (!result.ok) {
      throw new Error(
        `Could not load volume: ${path}`,
      );
    }

    const $ = loadCheerio(
      await result.text(),
    );

    /*
     * TensuraFan has selectable translation terms.
     * LNReader doesn't run the site's preference system
     * properly, so use the clean data-term text instead.
     */
    $('[data-term]').each((_, element) => {
      const term =
        $(element).attr('data-term');

      if (term) {
        $(element).text(term);
      }

      $(element).removeAttr('onclick');
    });

    $('[onclick]').removeAttr('onclick');

    $('script').remove();

    return $;
  }

  private cleanText(
    text: string,
  ): string {
    return text
      .replace(
        /\{[^{}]*(?:this\.app|allTermsChosen)[^{}]*\}/gi,
        '',
      )
      .replace(/\s+/g, ' ')
      .replace(
        /\s+([,:;.!?])/g,
        '$1',
      )
      .trim();
  }

  private getChapters(
    $: CheerioAPI,
  ): ChapterInfo[] {
    const chapters: ChapterInfo[] = [];
    const seen = new Set<string>();

    $('a.hlink[href*="#"]').each(
      (_, element) => {
        const href =
          $(element).attr('href') || '';

        const hashIndex =
          href.indexOf('#');

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
         * Fallback if template garbage appears
         * in the TOC.
         */
        if (
          !name ||
          name.includes('this.app') ||
          name.includes(
            'allTermsChosen',
          ) ||
          name.includes('{') ||
          name.includes('}')
        ) {
          const chapterIndex =
            chapters.length;

          const numberHeading =
            $('h1.ch-number')
              .eq(chapterIndex)
              .text();

          const nameHeading =
            $('h1.ch-number')
              .eq(chapterIndex)
              .nextAll('h1.ch-name')
              .first()
              .text();

          const number =
            this.cleanText(
              numberHeading,
            );

          const chapterName =
            this.cleanText(
              nameHeading,
            );

          if (
            number &&
            chapterName
          ) {
            name =
              `${number}: ${chapterName}`;
          } else if (number) {
            name = number;
          }
        }

        chapters.push({
          name,
          anchor,
        });
      },
    );

    return chapters;
  }

  private async getSeriesChapters():
    Promise<SeriesChapter[]> {
    const volumes =
      await this.getVolumes();

    /*
     * Fetch every volume to build one continuous
     * chapter list for the combined entry.
     */
    const loaded =
      await Promise.all(
        volumes.map(async volume => {
          const $ =
            await this.loadVolume(
              volume.path,
            );

          const chapters =
            this.getChapters($);

          return {
            volume,
            chapters,
          };
        }),
      );

    const result: SeriesChapter[] = [];

    for (const item of loaded) {
      item.chapters.forEach(
        (chapter, localIndex) => {
          result.push({
            volume: item.volume,
            chapter,
            localIndex,
          });
        },
      );
    }

    return result;
  }

  private makeVolumeItems(
    volumes: Volume[],
  ): Plugin.NovelItem[] {
    return volumes.map(volume => ({
      name: volume.name,
      path: volume.path,
      cover: defaultCover,
    }));
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

    const volumes =
      await this.getVolumes();

    /*
     * First item = new combined version.
     *
     * Everything after it = the old working
     * individual-volume entries.
     */
    return [
      {
        name: this.seriesName,
        path: this.seriesPath,
        cover: defaultCover,
      },

      ...this.makeVolumeItems(
        volumes,
      ),
    ];
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

    const volumes =
      await this.getVolumes();

    const results:
      Plugin.NovelItem[] = [];

    /*
     * Include combined version in search.
     */
    if (
      !query ||
      this.seriesName
        .toLowerCase()
        .includes(query) ||
      'tensura'.includes(query) ||
      'slime'.includes(query)
    ) {
      results.push({
        name: this.seriesName,
        path: this.seriesPath,
        cover: defaultCover,
      });
    }

    /*
     * Keep individual volume search working too.
     */
    results.push(
      ...this.makeVolumeItems(
        volumes.filter(volume =>
          !query
            ? true
            : volume.name
                .toLowerCase()
                .includes(query),
        ),
      ),
    );

    return results;
  }

  private async parseSingleVolume(
    novelPath: string,
  ): Promise<Plugin.SourceNovel> {
    /*
     * This is the old working 1.0.3 behavior.
     */
    const $ =
      await this.loadVolume(
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

    const chapters =
      chapterList.map(
        (chapter, index) => ({
          name: chapter.name,

          path:
            `${novelPath}#${index}`,

          chapterNumber:
            index + 1,
        }),
      );

    return {
      path: novelPath,
      name: volumeName,
      author: 'Fuse',
      genres:
        'Light Novel, Fantasy',
      status:
        NovelStatus.Completed,
      summary:
        'Fan translation of That Time I Got Reincarnated as a Slime (Tensura), hosted by TensuraFan.',
      cover: defaultCover,
      chapters,
    };
  }

  private async parseCombinedSeries():
    Promise<Plugin.SourceNovel> {
    const seriesChapters =
      await this.getSeriesChapters();

    const chapters =
      seriesChapters.map(
        (item, index) => ({
          /*
           * LNReader itself should display:
           *
           * Chapter 1
           * Chapter 2
           * ...
           *
           * while this is the chapter title.
           */
          name:
            `${item.volume.name} - ${item.chapter.name}`,

          path:
            `${this.seriesPath}#${index}`,

          chapterNumber:
            index + 1,
        }),
      );

    return {
      path: this.seriesPath,
      name: this.seriesName,
      author: 'Fuse',
      genres:
        'Light Novel, Fantasy',
      status:
        NovelStatus.Completed,
      summary:
        'Fan translation of That Time I Got Reincarnated as a Slime (Tensura), hosted by TensuraFan.',
      cover: defaultCover,
      chapters,
    };
  }

  async parseNovel(
    novelPath: string,
  ): Promise<Plugin.SourceNovel> {
    /*
     * NEW combined entry.
     */
    if (
      novelPath ===
      this.seriesPath
    ) {
      return this.parseCombinedSeries();
    }

    /*
     * OLD individual-volume behavior.
     */
    return this.parseSingleVolume(
      novelPath,
    );
  }

  private async parseSingleVolumeChapter(
    volumePath: string,
    chapterIndex: number,
  ): Promise<string> {
    /*
     * This is kept deliberately close to
     * the working 1.0.3 chapter parser.
     */
    const $ =
      await this.loadVolume(
        volumePath,
      );

    const chapterStarts =
      $('h1.ch-number').toArray();

    const start =
      chapterStarts[
        chapterIndex
      ];

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
          $(current).attr('id') ||
          ''
        ).toLowerCase();

        if (
          tag === 'h1' &&
          $(current).hasClass(
            'ch-number',
          )
        ) {
          break;
        }

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

      if (
        current.type === 'tag'
      ) {
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

      current =
        current.nextSibling;
    }

    let content =
      pieces
        .join('\n')
        .trim();

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

  private async parseCombinedChapter(
    globalIndex: number,
  ): Promise<string> {
    const volumes =
      await this.getVolumes();

    let remaining =
      globalIndex;

    /*
     * Walk through the volume chapter counts until
     * we find which volume contains this global
     * chapter number.
     */
    for (const volume of volumes) {
      const $ =
        await this.loadVolume(
          volume.path,
        );

      const chapterList =
        this.getChapters($);

      if (
        remaining <
        chapterList.length
      ) {
        return this.parseSingleVolumeChapter(
          volume.path,
          remaining,
        );
      }

      remaining -=
        chapterList.length;
    }

    throw new Error(
      `Series chapter ${globalIndex} was not found`,
    );
  }

  async parseChapter(
    chapterPath: string,
  ): Promise<string> {
    const hashIndex =
      chapterPath.lastIndexOf('#');

    if (hashIndex === -1) {
      throw new Error(
        `Invalid TensuraFan chapter path: ${chapterPath}`,
      );
    }

    const basePath =
      chapterPath.slice(
        0,
        hashIndex,
      );

    const chapterIndex = Number(
      chapterPath.slice(
        hashIndex + 1,
      ),
    );

    if (
      !Number.isInteger(
        chapterIndex,
      ) ||
      chapterIndex < 0
    ) {
      throw new Error(
        `Invalid chapter number: ${chapterPath}`,
      );
    }

    /*
     * Combined series.
     */
    if (
      basePath ===
      this.seriesPath
    ) {
      return this.parseCombinedChapter(
        chapterIndex,
      );
    }

    /*
     * Existing individual volume.
     */
    return this.parseSingleVolumeChapter(
      basePath,
      chapterIndex,
    );
  }

  resolveUrl = (
    path: string,
  ) => {
    if (
      path.startsWith('http')
    ) {
      return path;
    }

    if (
      path.startsWith('//')
    ) {
      return 'https:' + path;
    }

    if (
      path.startsWith('/')
    ) {
      return this.site + path;
    }

    return (
      `${this.site}/` +
      path.replace(
        /^\.\//,
        '',
      )
    );
  };
}

export default new TensuraFanPlugin();
