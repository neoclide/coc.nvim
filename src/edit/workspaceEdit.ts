/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { URI } from "vscode-uri"
import { Position } from "./position"
import { Range } from "./range"
import { TextEdit } from "./textEdit"

/**
 * Remove all falsy values from `array`. The original array IS modified.
 */
function coalesceInPlace<T>(array: Array<T | undefined | null>): void {
  let to = 0
  for (let i = 0; i < array.length; i++) {
    if (array[i]) {
      array[to] = array[i]
      to += 1
    }
  }
  array.length = to
}

/**
 * Additional data for entries of a workspace edit. Supports to label entries and marks entries
 * as needing confirmation by the user. The editor groups edits with equal labels into tree nodes,
 * for instance all edits labelled with "Changes in Strings" would be a tree node.
 */
export interface WorkspaceEditEntryMetadata {

  /**
   * A flag which indicates that user confirmation is needed.
   */
  needsConfirmation: boolean;

  /**
   * A human-readable string which is rendered prominent.
   */
  label: string;

  /**
   * A human-readable string which is rendered less prominent on the same line.
   */
  description?: string;

  /**
   * The icon path or {@link ThemeIcon} for the edit.
   */
  iconPath?: URI | { light: URI; dark: URI };
}

export interface IFileOperationOptions {
  overwrite?: boolean;
  ignoreIfExists?: boolean;
  ignoreIfNotExists?: boolean;
  recursive?: boolean;
}

export const enum FileEditType {
  File = 1,
  Text = 2,
  Cell = 3,
  CellReplace = 5,
}

export interface IFileOperation {
  _type: FileEditType.File;
  from?: URI;
  to?: URI;
  options?: IFileOperationOptions;
  metadata?: WorkspaceEditEntryMetadata;
}

export interface IFileTextEdit {
  _type: FileEditType.Text;
  uri: URI;
  edit: TextEdit;
  metadata?: WorkspaceEditEntryMetadata;
}

type WorkspaceEditEntry = IFileOperation | IFileTextEdit

export class WorkspaceEdit {

  private readonly _edits: WorkspaceEditEntry[] = []

  public _allEntries(): ReadonlyArray<WorkspaceEditEntry> {
    return this._edits
  }

  // --- file

  public renameFile(from: URI, to: URI, options?: { overwrite?: boolean; ignoreIfExists?: boolean }, metadata?: WorkspaceEditEntryMetadata): void {
    this._edits.push({ _type: FileEditType.File, from, to, options, metadata })
  }

  public createFile(uri: URI, options?: { overwrite?: boolean; ignoreIfExists?: boolean }, metadata?: WorkspaceEditEntryMetadata): void {
    this._edits.push({ _type: FileEditType.File, from: undefined, to: uri, options, metadata })
  }

  public deleteFile(uri: URI, options?: { recursive?: boolean; ignoreIfNotExists?: boolean }, metadata?: WorkspaceEditEntryMetadata): void {
    this._edits.push({ _type: FileEditType.File, from: uri, to: undefined, options, metadata })
  }

  // --- text

  public replace(uri: URI, range: Range, newText: string, metadata?: WorkspaceEditEntryMetadata): void {
    this._edits.push({ _type: FileEditType.Text, uri, edit: new TextEdit(range, newText), metadata })
  }

  public insert(resource: URI, position: Position, newText: string, metadata?: WorkspaceEditEntryMetadata): void {
    this.replace(resource, new Range(position, position), newText, metadata)
  }

  public delete(resource: URI, range: Range, metadata?: WorkspaceEditEntryMetadata): void {
    this.replace(resource, range, '', metadata)
  }

  // --- text (Maplike)

  public has(uri: URI): boolean {
    return this._edits.some(edit => edit._type === FileEditType.Text && edit.uri.toString() === uri.toString())
  }

  public set(uri: URI, edits: TextEdit[]): void {
    if (!edits) {
      // remove all text edits for `uri`
      for (let i = 0; i < this._edits.length; i++) {
        const element = this._edits[i]
        if (element._type === FileEditType.Text && element.uri.toString() === uri.toString()) {
          this._edits[i] = undefined! // will be coalesced down below
        }
      }
      coalesceInPlace(this._edits)
    } else {
      // append edit to the end
      for (const edit of edits) {
        if (edit) {
          this._edits.push({ _type: FileEditType.Text, uri, edit })
        }
      }
    }
  }

  public get(uri: URI): TextEdit[] {
    const res: TextEdit[] = []
    for (let candidate of this._edits) {
      if (candidate._type === FileEditType.Text && candidate.uri.toString() === uri.toString()) {
        res.push(candidate.edit)
      }
    }
    return res
  }

  public entries(): [URI, TextEdit[]][] {
    const textEdits = new ResourceMap<[URI, TextEdit[]]>()
    for (let candidate of this._edits) {
      if (candidate._type === FileEditType.Text) {
        let textEdit = textEdits.get(candidate.uri)
        if (!textEdit) {
          textEdit = [candidate.uri, []]
          textEdits.set(candidate.uri, textEdit)
        }
        textEdit[1].push(candidate.edit)
      }
    }
    return [...textEdits.values()]
  }

  public get size(): number {
    return this.entries().length
  }

  public toJSON(): any {
    return this.entries()
  }
}
