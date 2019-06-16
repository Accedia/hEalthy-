import { Injectable } from '@nestjs/common';
import { SubstanceDTO } from './data/dto/substance.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CacheService } from './cache.service';
import { Study } from './data/entities/study';

@Injectable()
export class AppService {
  constructor(
    @InjectRepository(Study)
    private readonly studyRepository: Repository<Study>,
    private readonly cacheService: CacheService,
  ) { }

  async findSubstanceByName(substance: string): Promise<SubstanceDTO[]> {
    const term = substance.toLowerCase().trim();
    const substances = this.cacheService.Substances
      .filter(sb => this.evaluateEqualness(sb.Name.toLowerCase(), term)
        || sb.Synonymes.some(syn => this.evaluateEqualness(syn.toLowerCase(), term)));

    await this.includeStudies(substances);

    return Object.entries(this.groupBy(substances, 'MasterExternalId'))
      .map(x => this.aggreagateSubstance(x));
  }

  async querySubstances(query: string): Promise<SubstanceDTO[]> {
    const ingredientsString = 'ingredients: ';
    const startOfIngredients = query.indexOf(ingredientsString) + ingredientsString.length;
    const endOfIngredients = query.substring(startOfIngredients).indexOf('.');
    const ingredients = query.slice(startOfIngredients, (endOfIngredients + ingredientsString.length));

    const ingredientNames = ingredients.toLowerCase().split(', ').map(x => x.trim());

    const matchedSubstances = this.cacheService.Substances
      .filter(substance => ingredientNames.includes(substance.Name.toLowerCase())
          || ingredientNames.some(x => this.evaluateEqualness(x, substance.Name.toLowerCase()))
        || this.selectSynonyms(substance, ingredientNames));

    await this.includeStudies(matchedSubstances);

    return Object.entries(this.groupBy(matchedSubstances, 'MasterExternalId'))
      .map(x => this.aggreagateSubstance(x));
  }

  private selectSynonyms(substance: SubstanceDTO, ingredientNames: string[]): boolean {
    return substance.Synonymes.map(syn => syn.toLowerCase())
      .some(v => ingredientNames.includes(v) || ingredientNames.some(x => this.evaluateEqualness(x, v)));
  }

  private aggreagateSubstance(substanceMap: any[]): SubstanceDTO {
    return {
      Id: substanceMap[1][0].Id,
      ExternalId: substanceMap[1][0].ExternalId,
      Name: substanceMap[1][0].Name,
      Description: substanceMap[1][0].Description,
      ExternalUrl: substanceMap[1][0].ExternalUrl,
      Synonymes: [...new Set((substanceMap[1] as SubstanceDTO[]).reduce((a, b) => a = a.concat(b.Synonymes), []))],
      Studies: (substanceMap[1] as SubstanceDTO[]).reduce((a, b) => a = a.concat(b.Studies), []),
    } as SubstanceDTO;
  }

  private async includeStudies(substances: SubstanceDTO[]): Promise<void> {
    const substanceIds = substances.map(s => s.Id);

    const studies = substances.length > 0 ?
      this.groupBy(await this.studyRepository.find({
        where: {
          SubstanceID: In(substanceIds),
        },
      }), 'SubstanceID') : [];

    substances.forEach(sub => sub.Studies = studies[sub.Id]
      ? studies[sub.Id]
      : []);
  }

  private groupBy(items: any[], key: string) {
    return items.reduce(
      (result, item) => ({
        ...result,
        [item[key]]: [
          ...(result[item[key]] || []),
          item,
        ],
      }),
      {},
    );
  }

  private evaluateEqualness(existingSubstance: string, querySubstance: string): boolean {
    const distance = this.damerauLevenshteinDistance(existingSubstance, querySubstance);
    if (distance > querySubstance.length * 0.20) {
      return false;
    } else {
      return true;
    }
  }

  public damerauLevenshteinDistance(source, target) {
    if (!source || source.length === 0) {
      if (!target || target.length === 0) {
        return 0;
      } else {
        return target.length;
      }
    } else if (!target) {
      return source.length;
    }
    const sourceLength = source.length;
    const targetLength = target.length;
    const score = [];

    const INF = sourceLength + targetLength;
    score[0] = [INF];
    for (let i = 0; i <= sourceLength; i++) { score[i + 1] = []; score[i + 1][1] = i; score[i + 1][0] = INF; }
    for (let i = 0; i <= targetLength; i++) { score[1][i + 1] = i; score[0][i + 1] = INF; }

    const sd = {};
    const combinedStrings = source + target;
    const combinedStringsLength = combinedStrings.length;
    for (let i = 0; i < combinedStringsLength; i++) {
      const letter = combinedStrings[i];
      if (!sd.hasOwnProperty(letter)) {
        sd[letter] = 0;
      }
    }

    for (let i = 1; i <= sourceLength; i++) {
      let DB = 0;
      for (let j = 1; j <= targetLength; j++) {
        const i1 = sd[target[j - 1]];
        const j1 = DB;

        if (source[i - 1] === target[j - 1]) {
          score[i + 1][j + 1] = score[i][j];
          DB = j;
        } else {
          score[i + 1][j + 1] = Math.min(score[i][j], Math.min(score[i + 1][j], score[i][j + 1])) + 1;
        }

        score[i + 1][j + 1] = Math.min(score[i + 1][j + 1], score[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1));
      }
      sd[source[i - 1]] = i;
    }
    return score[sourceLength + 1][targetLength + 1];
  }
}
