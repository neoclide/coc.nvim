import { Command, MarkupContent } from 'vscode-languageserver-protocol'

export interface TreeItemLabel {
  label: string
  highlights?: [number, number][]
}

export interface TreeItemIcon {
  text: string
  hlGroup: string
}

/**
 * Collapsible state of the tree item
 */
export enum TreeItemCollapsibleState {
  /**
   * Determines an item can be neither collapsed nor expanded. Implies it has no children.
   */
  None = 0,
  /**
   * Determines an item is collapsed
   */
  Collapsed = 1,
  /**
   * Determines an item is expanded
   */
  Expanded = 2
}

export class TreeItem {
  public label: string | TreeItemLabel
  public icon?: TreeItemIcon
  public command?: Command
  public tooltip?: string | MarkupContent

  constructor(label: string | TreeItemLabel, public collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
    this.label = label
  }
}
