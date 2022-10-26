'use strict'
import { Emitter, Event } from 'vscode-languageserver-protocol'
import type { IJSONSchema } from './jsonSchema'
import { Registry } from './registry'

export const Extensions = {
  JSONContribution: 'base.contributions.json'
}

export interface ISchemaContributions {
  schemas: { [id: string]: IJSONSchema }
}

export interface IJSONContributionRegistry {

  readonly onDidChangeSchema: Event<string>

  /**
   * Register a schema to the registry.
   */
  registerSchema(uri: string, unresolvedSchemaContent: IJSONSchema): void

  /**
   * Notifies all listeners that the content of the given schema has changed.
   *
   * @param uri The id of the schema
   */
  notifySchemaChanged(uri: string): void

  /**
   * Get all schemas
   */
  getSchemaContributions(): ISchemaContributions
}

class JSONContributionRegistry implements IJSONContributionRegistry {

  private schemasById: { [id: string]: IJSONSchema }

  private readonly _onDidChangeSchema = new Emitter<string>()
  public readonly onDidChangeSchema: Event<string> = this._onDidChangeSchema.event

  constructor() {
    this.schemasById = {}
  }

  public registerSchema(uri: string, unresolvedSchemaContent: IJSONSchema): void {
    this.schemasById[uri] = unresolvedSchemaContent
    this._onDidChangeSchema.fire(uri)
  }

  public notifySchemaChanged(uri: string): void {
    this._onDidChangeSchema.fire(uri)
  }

  public getSchemaContributions(): ISchemaContributions {
    return {
      schemas: this.schemasById,
    }
  }

}

const jsonContributionRegistry = new JSONContributionRegistry()
Registry.add(Extensions.JSONContribution, jsonContributionRegistry)
