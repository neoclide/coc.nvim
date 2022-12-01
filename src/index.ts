'use strict'
import {
  AnnotatedTextEdit, ChangeAnnotation, ChangeAnnotationIdentifier, CodeAction, CodeActionContext, CodeActionKind,
  CodeActionTriggerKind, CodeDescription, CodeLens, Color,
  ColorInformation,
  ColorPresentation, Command, CompletionItem, CompletionItemKind, CompletionItemLabelDetails, CompletionItemTag,
  CompletionList, CreateFile, DeleteFile, Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity, DiagnosticTag, DocumentHighlight, DocumentHighlightKind, DocumentLink, DocumentSymbol, DocumentUri, FoldingRange, FoldingRangeKind, FormattingOptions, Hover, InlayHint, InlayHintKind,
  InlayHintLabelPart, InlineValueContext, InlineValueEvaluatableExpression, InlineValueText,
  InlineValueVariableLookup, InsertReplaceEdit, InsertTextFormat, InsertTextMode, integer, Location,
  LocationLink, MarkedString, MarkupContent, MarkupKind, OptionalVersionedTextDocumentIdentifier, ParameterInformation, Position,
  Range, RenameFile, SelectionRange, SemanticTokenModifiers,
  SemanticTokens, SemanticTokenTypes, SignatureInformation,
  SymbolInformation, SymbolKind, SymbolTag, TextDocumentEdit, TextDocumentIdentifier, TextDocumentItem, TextEdit, uinteger, VersionedTextDocumentIdentifier, WorkspaceChange, WorkspaceEdit, WorkspaceFolder, WorkspaceSymbol
} from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import commands from './commands'
import diagnosticManager from './diagnostic/manager'
import events from './events'
import extensions from './extension'
import languages, { ProviderName } from './languages'
import BasicList from './list/basic'
import listManager from './list/manager'
import download from './model/download'
import fetch from './model/fetch'
import FloatFactory from './model/floatFactory'
import Highligher from './model/highligher'
import Mru from './model/mru'
import RelativePattern from './model/relativePattern'
import services, { ServiceStat } from './services'
import snippetManager from './snippets/manager'
import { SnippetString } from './snippets/string'
import sources from './completion/sources'
import { ansiparse } from './util/ansiparse'
import { CancellationError } from './util/errors'
import { Mutex } from './util/mutex'
import {
  CancellationToken,
  CancellationTokenSource, CompletionTriggerKind, Disposable, DocumentDiagnosticReportKind, Emitter, ErrorCodes, Event, FileChangeType, MonikerKind, NotificationType,
  NotificationType0, ProgressType, ProtocolNotificationType,
  ProtocolNotificationType0, ProtocolRequestType,
  ProtocolRequestType0, RequestType,
  RequestType0, ResponseError, SignatureHelpTriggerKind, Trace, UniquenessLevel
} from './util/protocol'
import window from './window'
import workspace from './workspace'

import {
  ClientState,
  CloseAction,
  ErrorAction, LanguageClient,
  MessageTransports, NullLogger, RevealOutputChannelOn, SettingMonitor, State, TransportKind
} from './language-client'

import LineBuilder from './model/line'
import { SemanticTokensBuilder } from './model/semanticTokensBuilder'
import { TreeItem, TreeItemCollapsibleState } from './tree/index'
import { concurrent, disposeAll, wait } from './util'
import { FileType, watchFile } from './util/fs'
import { executable, isRunning, runCommand, terminate } from './util/processes'
import { ConfigurationUpdateTarget } from './configuration/types'
import { SourceType } from './completion/types'
import { PatternType } from './core/workspaceFolder'

module.exports = {
  get nvim() {
    return workspace.nvim
  },
  Uri: URI,
  LineBuilder,
  NullLogger,
  SettingMonitor,
  LanguageClient,
  CancellationTokenSource,
  ProgressType,
  RequestType,
  RequestType0,
  NotificationType,
  NotificationType0,
  ProtocolRequestType,
  ProtocolRequestType0,
  ProtocolNotificationType,
  ProtocolNotificationType0,
  Highligher,
  Mru,
  Emitter,
  SnippetString,
  BasicList,
  Mutex,
  TreeItem,
  SemanticTokensBuilder,
  FloatFactory,
  RelativePattern,
  CancellationError,
  WorkspaceChange,
  ResponseError,
  Trace,
  DocumentUri,
  WorkspaceFolder,
  InlineValueText,
  InlineValueVariableLookup,
  InlineValueEvaluatableExpression,
  InlineValueContext,
  InlayHintKind,
  InlayHintLabelPart,
  InlayHint,
  DiagnosticRelatedInformation,
  SemanticTokens,
  SemanticTokenTypes,
  SemanticTokenModifiers,
  AnnotatedTextEdit,
  ChangeAnnotation,
  SymbolTag,
  Command,
  Color,
  CodeDescription,
  ColorInformation,
  ColorPresentation,
  TextDocumentEdit,
  TextDocumentIdentifier,
  VersionedTextDocumentIdentifier,
  TextDocumentItem,
  DocumentHighlight,
  SelectionRange,
  DocumentLink,
  CodeLens,
  FormattingOptions,
  CodeAction,
  CodeActionContext,
  DocumentSymbol,
  WorkspaceSymbol,
  CreateFile,
  RenameFile,
  WorkspaceEdit,
  InsertReplaceEdit,
  InsertTextMode,
  CompletionItem,
  CompletionList,
  Hover,
  ParameterInformation,
  SignatureInformation,
  SymbolInformation,
  MarkupContent,
  ErrorCodes,
  CompletionItemTag,
  integer,
  uinteger,
  FoldingRangeKind,
  FoldingRange,
  ChangeAnnotationIdentifier,
  DeleteFile,
  OptionalVersionedTextDocumentIdentifier,
  CompletionItemLabelDetails,
  MarkedString,
  ProviderName,
  DocumentDiagnosticReportKind,
  UniquenessLevel,
  MonikerKind,
  PatternType,
  SourceType,
  ConfigurationTarget: ConfigurationUpdateTarget,
  ServiceStat,
  FileType,
  State,
  ClientState,
  CloseAction,
  ErrorAction,
  TransportKind,
  MessageTransports,
  RevealOutputChannelOn,
  MarkupKind,
  DiagnosticTag,
  DocumentHighlightKind,
  SymbolKind,
  SignatureHelpTriggerKind,
  FileChangeType,
  CodeActionKind,
  Diagnostic,
  DiagnosticSeverity,
  CompletionItemKind,
  InsertTextFormat,
  Location,
  LocationLink,
  CancellationToken,
  Position,
  Range,
  TextEdit,
  Disposable,
  Event,
  workspace,
  window,
  CodeActionTriggerKind,
  CompletionTriggerKind,
  snippetManager,
  events,
  services,
  commands,
  sources,
  languages,
  diagnosticManager,
  extensions,
  listManager,
  TreeItemCollapsibleState,
  terminate,
  fetch,
  download,
  ansiparse,
  disposeAll,
  concurrent,
  watchFile,
  wait,
  runCommand,
  isRunning,
  executable,
}
