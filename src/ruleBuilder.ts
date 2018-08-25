import * as vscode from "vscode";

// tslint:disable:max-classes-per-file

class ScopeDefinition {
    public readonly parent?: string;
    public readonly disabled?: boolean;
    public readonly openAndCloseCharactersAreTheSame?: boolean;
    public readonly startsWith?: string;
    public readonly openSuffix?: string;
    public readonly closeSuffix?: string;
}

class BasicDefinition {
    public readonly language: string;
    public readonly extends?: string;
    public readonly scopes?: ScopeDefinition[];
}

export enum BracketContext {
    Unknown,
    Open,
    Close,
}

export class TokenMatch {
    public readonly regex: RegExp;
    public readonly suffix?: string;
    public readonly parent?: string;
    public readonly disabled: boolean;
    public readonly context: BracketContext;
    public readonly openAndCloseCharactersAreTheSame: boolean;
    constructor(
        disabled: boolean,
        openAndCloseCharactersAreTheSame: boolean,
        startsWith: string,
        context: BracketContext,
        suffix: string | undefined,
        parent: string | undefined,
    ) {
        this.context = context;
        this.suffix = suffix;
        this.openAndCloseCharactersAreTheSame = openAndCloseCharactersAreTheSame;
        this.parent = parent;
        this.disabled = disabled;
        const regexStart = this.escapeRegExp(startsWith);
        if (suffix) {
            const regexEnd = this.escapeRegExp(suffix);
            this.regex = new RegExp("^" + regexStart + ".*" + regexEnd + "$");
        }
        else {
            this.regex = new RegExp("^" + regexStart);
        }
    }

    private escapeRegExp(input: string) {
        return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
    }
}

class DefinitionAfterInheritance {
    public readonly language: string;
    public readonly scopes: Map<string, ScopeDefinition>;

    constructor(language: string, scopes: Map<string, ScopeDefinition>) {
        this.language = language;
        this.scopes = scopes;
    }
}

export class RuleBuilder {
    private readonly start = new Map<string, BasicDefinition>();
    private readonly intermediate = new Map<string, DefinitionAfterInheritance>();
    private readonly final = new Map<string, TokenMatch[]>();

    constructor() {
        const userLanguages =
            vscode.workspace.getConfiguration("bracketPairColorizer2", undefined)
                .get("languages") as BasicDefinition[];

        for (const userLanguage of userLanguages) {
            this.start.set(userLanguage.language, userLanguage);
        }
    }

    public get(languageId: string) {
        const stackResult = this.final.get(languageId);
        if (stackResult) {
            return stackResult;
        }

        const baseLanguage = this.start.get(languageId);

        if (baseLanguage) {
            const history = new Set<BasicDefinition>();
            const scopesThisToBase = this.getAllScopes(baseLanguage, [], history);

            const scopeMap = new Map<string, ScopeDefinition>();

            // Set base map first then let extended languages overwrite
            for (let i = scopesThisToBase.length; i-- > 0;) {
                for (const scope of scopesThisToBase[i]) {
                    if (!scope.startsWith) {
                        console.error("Missing 'startsWith' property");
                        console.error(scope);
                        continue;
                    }

                    scopeMap.set(scope.startsWith, scope);
                }
            }

            const extendedLanguage = new DefinitionAfterInheritance(baseLanguage.language, scopeMap);

            this.intermediate.set(extendedLanguage.language, extendedLanguage);

            const tokens: TokenMatch[] = [];
            for (const scope of scopeMap.values()) {
                if (!scope.startsWith) {
                    console.error("Missing 'startsWith' property");
                    console.error(scope);
                    continue;
                }

                const depth = scope.parent || 0;
                if (scope.openSuffix && scope.closeSuffix) {
                    tokens.push(
                        new TokenMatch(
                            !!scope.disabled,
                            !!scope.openAndCloseCharactersAreTheSame,
                            scope.startsWith,
                            BracketContext.Open,
                            scope.openSuffix,
                            scope.parent,
                        ),
                        new TokenMatch(
                            !!scope.disabled,
                            !!scope.openAndCloseCharactersAreTheSame,
                            scope.startsWith,
                            BracketContext.Close,
                            scope.closeSuffix,
                            scope.parent,
                        ),
                    );
                }
                else {
                    tokens.push(
                        new TokenMatch(
                            !!scope.disabled,
                            !!scope.openAndCloseCharactersAreTheSame,
                            scope.startsWith,
                            BracketContext.Unknown,
                            undefined,
                            scope.parent,
                        ),
                    );
                }
            }

            this.final.set(languageId, tokens);
            return tokens;
        }

        return this.final.get("default");
    }

    private getAllScopes(
        userLanguageDefinition: BasicDefinition,
        allScopeDefinitions: ScopeDefinition[][],
        history: Set<BasicDefinition>): ScopeDefinition[][] {
        if (history.has(userLanguageDefinition)) {
            console.error("Cycle detected while parsing user languages: " +
                userLanguageDefinition.language + " => " +
                [...history.values()]);
            return allScopeDefinitions;
        }

        history.add(userLanguageDefinition);

        if (userLanguageDefinition.scopes) {
            allScopeDefinitions.push(userLanguageDefinition.scopes);
        }

        if (userLanguageDefinition.extends) {
            const parsedLanguage = this.intermediate.get(userLanguageDefinition.extends);

            if (parsedLanguage) {
                allScopeDefinitions.push([...parsedLanguage.scopes.values()]);
                return allScopeDefinitions;
            }

            const unParsedLanguage = this.start.get(userLanguageDefinition.extends);
            if (unParsedLanguage) {
                this.getAllScopes(unParsedLanguage, allScopeDefinitions, history);
            }
            else {
                console.error("Could not find user defined language: " + userLanguageDefinition.extends);
            }
        }

        return allScopeDefinitions;
    }
}
