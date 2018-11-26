import fs from 'fs';
import { ComponentDoc } from './types';

export interface IRegistry {
  registerFile(file: string, doc: ReadonlyArray<ComponentDoc>): void;
}

export class DocCache {
  private lastUpdate: number = 0;
  private cache: Map<string, ReadonlyArray<ComponentDoc>> = new Map();

  public getOrAdd(
    file: string,
    populate: (registry: IRegistry, file: string) => void,
  ): ReadonlyArray<ComponentDoc> {
    // as an optimization, we assume only changes in a particular file
    // can affect that file. If this is not the case, we're OK with a
    // server restart.
    const stat = fs.statSync(file);
    if (stat.ctimeMs - 1000 > this.lastUpdate) {
      let lastUpdate = this.lastUpdate;
      const registry = {
        registerFile: (file: string, doc: ReadonlyArray<ComponentDoc>) => {
          lastUpdate = Math.max(lastUpdate, fs.statSync(file).ctimeMs);
          this.cache.set(file, Object.freeze([...doc]));
        },
      };
      populate(registry, file);
      this.lastUpdate = lastUpdate;
    }

    const cached = this.cache.get(file);
    return cached || [];
  }
}
