export interface ParentType {
  readonly name: string;
  readonly fileName: string;
}

export interface PropItemType {
  readonly name: string;
  readonly value?: any;
}

export interface Component {
  readonly name: string;
}

export interface PropItem {
  readonly name: string;
  readonly required: boolean;
  readonly type: PropItemType;
  readonly description: string;
  readonly defaultValue: any;
  readonly parent?: ParentType;
}

export interface StringIndexedObject<T> {
  readonly [key: string]: T;
}

export interface Props extends StringIndexedObject<PropItem> {}

export interface ComponentDoc {
  readonly displayName: string;
  readonly description: string;
  readonly props: Props;
}

export type PropertyFilter = (prop: PropItem, comp: Component) => boolean;
