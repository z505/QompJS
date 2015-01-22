"use strict";

var Cast = require("js/EberonCast.js");
var Context = require("context.js");
var EbArray = require("js/EberonArray.js");
var CodeGenerator = require("js/CodeGenerator.js");
var EbContext = require("eberon/eberon_context.js");
var Grammar = require("grammar.js");
var EbRtl = require("js/EberonRtl.js");
var EbRtlCode = require("eberon/eberon_rtl.js");
var Parser = require("parser.js");
var Symbols = require("js/EberonSymbols.js");

var and = Parser.and;
var context = Parser.context;
var optional = Parser.optional;
var or = Parser.or;
var repeat = Parser.repeat;
var required = Parser.required;

function makeStrucType(base, type){
    var mapType = context(and("MAP", "OF", type), EbContext.MapDecl);
    return or(base, mapType);
}

function makeStatement(base, statementSequence, ident, expression){
    return or(base, 
              context(and("FOREACH", ident, ",", ident, "IN", expression, "DO", 
                          statementSequence, required("END", "END expected (FOREACH)")), 
                      EbContext.ForEach));
}

function makeProcedureHeading(ident, identdef, formalParameters){
    return and("PROCEDURE",
               context(and(optional(and(ident, ".")), identdef), EbContext.ProcOrMethodId),
               context(optional(formalParameters), EbContext.FormalParametersProcDecl)
               );
}

function makeInPlaceInit(ident, expression, inPlaceContext){
    return context(and(ident, "<-", required(expression, "initialization expression expected")), inPlaceContext);
}

function makeAssignmentOrProcedureCall(ident, designator, assignment, expression){
    return or(
        makeInPlaceInit(ident, expression, EbContext.InPlaceVariableInit),
        context(and(designator, optional(assignment)), EbContext.AssignmentOrProcedureCall)
        );
}

function makeIdentdef(ident){
    return context(and(ident, optional(or("*", "-"))), EbContext.Identdef);
}

function makeDesignator(ident, qualident, selector, actualParameters){
    var self = and("SELF", optional(and("(", "POINTER", ")")));
    var operatorNew = and("NEW", context(and(qualident, actualParameters), EbContext.OperatorNew));
    var designator = context(
        and(or(self, "SUPER", operatorNew, qualident), 
            repeat(or(selector, actualParameters))), EbContext.Designator);
    return { 
        factor: context(designator, EbContext.ExpressionProcedureCall),
        assignmentOrProcedureCall: function(assignment, expression){
            return makeAssignmentOrProcedureCall(ident, designator, assignment, expression);
        }
    };
}

function makeProcedureDeclaration(ident, procedureHeading, procedureBody){
    return context(and(procedureHeading, ";",
                       procedureBody,
                       optional(and(ident, optional(and(".", ident))))),
                   EbContext.ProcOrMethodDecl);
}

function makeMethodHeading(identdef, formalParameters){
    return context(
        and("PROCEDURE",
            identdef,
            context(optional(formalParameters), EbContext.FormalParametersProcDecl)),
        EbContext.MethodHeading);
}

function makeFieldList(identdef, identList, type, formalParameters){
    return context(
        or(makeMethodHeading(identdef, formalParameters),
               and(identList, ":", type)),
        Context.FieldListDeclaration);
}

function makeFieldListSequence(base){
    return and(base, optional(";"));
}

function makeForInit(ident, expression, assignment){
    return or(makeInPlaceInit(ident, expression, EbContext.InPlaceVariableInitFor), 
              and(ident, assignment));
}

function makeArrayDimensions(constExpression){
    var oneDimension = or("*", constExpression);
    return context(and(oneDimension, repeat(and(",", oneDimension))), 
                   EbContext.ArrayDimensions);
}

function makeFormalArray(){
    return and("ARRAY", optional("*"), "OF");
}

function makeFormalResult(base, ident, actualParameters){
    var initField = and(ident, actualParameters);
    var followingFields = repeat(and(",", initField));
    return or(base, 
              context(and("|", or(and("SUPER", actualParameters, followingFields),
                                  and(initField, followingFields))), 
                      EbContext.BaseInit));
}

function makeReturn(base){
    return and(base, optional(";"));
}

exports.language = {
    grammar: Grammar.make(
        makeIdentdef,
        makeDesignator,
        makeStrucType,
        makeStatement,
        makeProcedureHeading,
        makeProcedureDeclaration,
        makeFieldList, 
        makeFieldListSequence,
        makeForInit,
        makeArrayDimensions,
        makeFormalArray,
        makeFormalResult,
        makeReturn,
        { 
            constDeclaration:   EbContext.ConstDecl, 
            typeDeclaration:    EbContext.TypeDeclaration,
            recordDecl:         EbContext.RecordDecl,
            variableDeclaration: EbContext.VariableDeclaration,
            ArrayDecl:          EbContext.ArrayDecl,
            Factor:             EbContext.Factor,
            FormalParameters:   EbContext.FormalParameters,
            FormalType:         EbContext.FormalType,
            Term:               EbContext.Term,
            AddOperator:        EbContext.AddOperator,
            MulOperator:        EbContext.MulOperator,
            SimpleExpression:   EbContext.SimpleExpression, 
            Expression:         EbContext.Expression,
            For:                EbContext.For,
            While:              EbContext.While,
            If:                 EbContext.If,
            CaseLabel:          EbContext.CaseLabel,
            Repeat:             EbContext.Repeat,
            Return:             EbContext.Return,
            ModuleDeclaration:  EbContext.ModuleDeclaration
        },
        Grammar.reservedWords + " SELF SUPER MAP FOREACH"
        ),
    stdSymbols: Symbols.makeStd(),
    types: {
        implicitCast: Cast.implicit,
        StaticArray: EbArray.StaticArray,
        OpenArray: EbArray.OpenArray
    },
    codeGenerator: {
        make: CodeGenerator.makeGenerator,
        nil: CodeGenerator.nullGenerator()
    },
    rtl: {
        base: EbRtl.Type,
        methods: EbRtlCode.rtl.methods,
        dependencies: EbRtlCode.rtl.dependencies,
        nodejsModule: EbRtlCode.rtl.nodejsModule
    }
};
