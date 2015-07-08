"use strict";

var Cast = require("js/Cast.js");
var Class = require("rtl.js").Class;
var Code = require("js/Code.js");
var CodeGenerator = require("js/CodeGenerator.js");
var ContextCase = require("js/ContextCase.js");
var ContextConst = require("js/ContextConst.js");
var ContextDesignator = require("js/ContextDesignator.js");
var ContextExpression = require("js/ContextExpression.js");
var ContextIdentdef = require("js/ContextIdentdef.js");
var ContextIf = require("js/ContextIf.js");
var ContextLoop = require("js/ContextLoop.js");
var ContextModule = require("js/ContextModule.js");
var ContextHierarchy = require("js/ContextHierarchy.js");
var ContextProcedure = require("js/ContextProcedure.js");
var ContextType = require("js/ContextType.js");
var ContextVar = require("js/ContextVar.js");
var EberonConstructor = require("js/EberonConstructor.js");
var EberonContext = require("js/EberonContext.js");
var EberonContextDesignator = require("js/EberonContextDesignator.js");
var EberonContextProcedure = require("js/EberonContextProcedure.js");
var EberonDynamicArray = require("js/EberonDynamicArray.js");
var EberonMap = require("js/EberonMap.js");
var EberonRecord = require("js/EberonRecord.js");
var EberonScope = require("js/EberonScope.js");
var EberonString = require("js/EberonString.js");
var EberonTypes = require("js/EberonTypes.js");
var Errors = require("js/Errors.js");
var Expression = require("js/Expression.js");
var Module = require("js/Module.js");
var op = require("js/Operator.js");
var eOp = require("js/EberonOperator.js");
var Symbol = require("js/Symbols.js");
var Procedure = require("js/Procedure.js");
var Record = require("js/Record.js");
var Type = require("js/Types.js");
var TypeId = require("js/TypeId.js");
var TypePromotion = require("js/EberonTypePromotion.js");
var Variable = require("js/Variable.js");

/*
function log(s){
    console.info(s);
}
*/

var ChainedContext = ContextHierarchy.Node;
ChainedContext.extend = Class.extend;
ChainedContext.prototype.init = ContextHierarchy.Node;

var ProcOrMethodId = ChainedContext.extend({
    init: function EberonContext$ProcOrMethodId(parent){
        ChainedContext.prototype.init.call(this, parent);
        this.__maybeTypeId = undefined;
        this.__type = undefined;
    },
    handleIdent: function(id){this.__maybeTypeId = id;},
    handleLiteral: function(s){
        var ss = ContextHierarchy.getSymbolAndScope(this.root(), this.__maybeTypeId);
        var type = ContextExpression.unwrapType(ss.symbol().info());
        if (!(type instanceof Type.Record))
            throw new Errors.Error(
                  "RECORD type expected in method declaration, got '"
                + type.description() + "'");
        if (ss.scope() != this.root().currentScope())
            throw new Errors.Error(
                  "method should be defined in the same scope as its bound type '"
                + this.__maybeTypeId
                + "'");
        this.__type = type;
    },
    handleIdentdef: function(id){
        if (this.__type && id.exported())
            throw new Errors.Error("method implementation cannot be exported: " + id.id());
        checkOrdinaryExport(id, "procedure");
        this.handleMessage(new EberonContextProcedure.MethodOrProcMsg(id, this.__type));
    }
});

var MethodHeading = ChainedContext.extend({
    init: function EberonContext$MethodHeading(parent){
        ChainedContext.prototype.init.call(this, parent);
        this.__id = undefined;
        this.__type = undefined;
    },
    handleIdentdef: function(id){
        checkOrdinaryExport(id, "method");
        this.__id = id;
    },
    typeName: function(){return "";},
    setType: function(type){this.__type = type;},
    endParse: function(){
        this.handleMessage(new EberonContextProcedure.MethodOrProcMsg(this.__id, this.__type));
    }
});

var InPlaceStringLiteral = Class.extend.call(EberonContextDesignator.TypeNarrowVariable, {
    init: function(type){
        EberonContextDesignator.TypeNarrowVariable.call(this, type, false, true);
    },
    idType: function(){return "string literal";}
});

var ForEachVariable = Class.extend.call(EberonContextDesignator.TypeNarrowVariable, {
    init: function(type){
        EberonContextDesignator.TypeNarrowVariable.call(this, type, false, true);
    },
    idType: function(){return "FOR variable";}
});

var Identdef = Class.extend.call(ContextIdentdef.Type, {
    init: function(parent){
        ContextIdentdef.Type.call(this, parent);
        this.__ro = false;
    },
    handleLiteral: function(l){
        if (l == "-")
            this.__ro = true;  
        ContextIdentdef.Type.prototype.handleLiteral.call(this, l);
    },
    doMakeIdendef: function(){
        return new EberonContext.IdentdefInfo(this.id, this.export$, this.__ro);
    }
});

function makeContextCall(context, call){
    return call(ContextHierarchy.makeLanguageContext(context));
    }

var OperatorNew = ChainedContext.extend({
    init: function EberonContext$OperatorNew(parent){
        ChainedContext.prototype.init.call(this, parent);
        this.__info = undefined;
        this.__call = undefined;
    },
    handleQIdent: function(q){
        var found = ContextHierarchy.getQIdSymbolAndScope(this.root(), q);
        var s = found.symbol();
        var info = s.info();

        if (!(info instanceof TypeId.Type))
            throw new Errors.Error("record type is expected in operator NEW, got '" + info.idType() + "'");

        var type = info.type();
        if (!(type instanceof Type.Record))
            throw new Errors.Error("record type is expected in operator NEW, got '" + type.description() + "'");
        
        this.__info = info;        
    },
    handleExpression: function(e){
        this.__call.handleArgument(e);
    },
    handleMessage: function(msg){
        if (msg instanceof ContextDesignator.BeginCallMsg){
            this.__call = makeContextCall(
                this,
                function(cx){ return EberonConstructor.makeConstructorCall(this.__info, cx, true); }.bind(this)
                );
            return;
        }
        if (msg instanceof ContextDesignator.EndCallMsg)
            return;

        return ChainedContext.prototype.handleMessage.call(this, msg);
    },
    endParse: function(){
        this.handleMessage(new EberonContextDesignator.OperatorNewMsg(this.__call.end()));
    }
});

var InPlaceVariableInit = ChainedContext.extend({
    init: function EberonContext$InPlaceVariableInit(context){
        ChainedContext.prototype.init.call(this, context);
        this.__id = undefined;
        this._symbol = undefined;
        this._code = undefined;
    },
    codeGenerator: function(){return CodeGenerator.nullGenerator();},
    handleIdent: function(id){
        this.__id = id;
    },
    handleLiteral: function(){
        this._code = "var " + this.__id + " = ";
    },
    handleExpression: function(e){
        var type = e.type();
        var isString = Type.isString(type);
        if (!isString && !(type instanceof Type.StorageType))
            throw new Errors.Error("cannot use " + type.description() + " to initialize variable");
        var v = isString ? new InPlaceStringLiteral(type) 
                         : new EberonContextDesignator.TypeNarrowVariable(type, false, false, this.__id);
        this._symbol = new Symbol.Symbol(this.__id, v);
        if (type instanceof Type.Record){
            EberonRecord.ensureCanBeInstantiated(this, type, EberonRecord.instantiateForCopy);
            if (e.designator()){
                var l = this.root().language();
                this._code += l.rtl.clone(e.code(), l.types.typeInfo(type));
            }
            else // do not clone if it is temporary, e.g. constructor call
                this._code += e.code();
        }
        else {
            if (type instanceof Type.OpenArray)
                throw new Errors.Error("cannot initialize variable '" + this.__id + "' with open array");
          
            var language = this.root().language();
            var cloneOp;
            language.types.implicitCast(type, type, false, {set: function(v){cloneOp = v;}, get:function(){return cloneOp;}});
            this._code += cloneOp.clone(ContextHierarchy.makeLanguageContext(this), e);
        }
    },
    _onParsed: function(){
        this.parent().codeGenerator().write(this._code);
    },
    endParse: function(){
        if (!this._symbol)
            return false;

        this.root().currentScope().addSymbol(this._symbol);
        this._onParsed();
        return true;
    }
});

var InPlaceVariableInitFor = InPlaceVariableInit.extend({
    init: function EberonContext$InPlaceVariableInitFor(context){
        InPlaceVariableInit.prototype.init.call(this, context);
    },
    _onParsed: function(){
        this.parent().handleInPlaceInit(this._symbol, this._code);
    }
});

var ExpressionProcedureCall = ChainedContext.extend({
    init: function EberonContext$init(context){
        ChainedContext.prototype.init.call(this, context);
        this.attributes = {};
    },
    endParse: function(){
        var parent = this.parent();
        var d = this.attributes.designator;
        var info = d.info();
        var e;
        if (info instanceof EberonContextDesignator.ResultVariable){
            e = info.expression;
            e = new Expression.Type(d.code(), d.type(), undefined, e.constValue(), e.maxPrecedence());
        }
        else
            e = ContextExpression.designatorAsExpression(d);
        parent.handleExpression(e);
    }
});

var AssignmentOrProcedureCall = ChainedContext.extend({
    init: function EberonContext$init(context){
        ChainedContext.prototype.init.call(this, context);
        this.attributes = {};
        this.__right = undefined;
    },
    handleExpression: function(e){
        this.__right = e;
    },
    codeGenerator: function(){return CodeGenerator.nullGenerator();},
    endParse: function(){
        var d = this.attributes.designator;
        var type = d.type();
        var code;
        if (this.__right){
            var left = Expression.make(d.code(), type, d);
            code = op.assign(left, this.__right, ContextHierarchy.makeLanguageContext(this));
        }
        else if (!(d.info() instanceof EberonContextDesignator.ResultVariable)){
            var procCall = ContextProcedure.makeCall(this, type, d.info());
            var result = procCall.end();
            Module.assertProcStatementResult(result.type());
            code = d.code() + result.code();
        }
        else{
            Module.assertProcStatementResult(type);
            code = d.code();
        }
    
    this.parent().codeGenerator().write(code);
    }
});

function checkOrdinaryExport(id, hint){
    if (id.isReadOnly())
        throw new Errors.Error(hint + " cannot be exported as read-only using '-' mark (did you mean '*'?)");
}

var ConstDecl = Class.extend.call(ContextConst.Type, {
    init: function EberonContext$ConstDecl(context){
        ContextConst.Type.call(this, context);
    },
    handleIdentdef: function(id){
        checkOrdinaryExport(id, "constant");
        ContextConst.Type.prototype.handleIdentdef.call(this, id);
    }
});

var VariableDeclaration = Class.extend.call(ContextVar.Declaration, {
    init: function EberonContext$VariableDeclaration(context){
        ContextVar.Declaration.call(this, context);
    },
    handleIdentdef: function(id){
        checkOrdinaryExport(id, "variable");
        ContextVar.Declaration.prototype.handleIdentdef.call(this, id);
    },
    doInitCode: function(){
        var type = this.type;
        if (type instanceof EberonRecord.Record)
            EberonRecord.ensureCanBeInstantiated(this, type, EberonRecord.instantiateForVar);
        return ContextVar.Declaration.prototype.doInitCode.call(this);
    }
});

var TypeDeclaration = Class.extend.call(ContextType.Declaration, {
    init: function EberonContext$TypeDeclaration(context){
        ContextType.Declaration.call(this, context);
    },
    handleIdentdef: function(id){
        checkOrdinaryExport(id, "type");
        ContextType.Declaration.prototype.handleIdentdef.call(this, id);
    }
});

var RecordDecl = Class.extend.call(ContextType.Record, {
    init: function EberonContext$RecordDecl(context){
        ContextType.Record.call(this, context, function(name, cons, scope){return new EberonRecord.Record(name, cons, scope); });
    },
    handleMessage: function(msg){
        if (msg instanceof EberonContextProcedure.MethodOrProcMsg){
            var methodType = msg.type;
            var boundType = this.type;
            var id = msg.id.id();
            if (Type.typeName(boundType) == id){
                if (msg.id.exported()){
                    var typeId = this.parent().id;
                    if (!typeId.exported())
                        throw new Errors.Error("constructor '" + id + "' cannot be exported because record itslef is not exported");
                }
                boundType.declareConstructor(methodType, msg.id.exported());
            }
            else
                boundType.addMethod(msg.id,
                                    new EberonTypes.MethodType(id, methodType, Procedure.makeProcCallGenerator));
            return;
        }

        if (msg instanceof ContextProcedure.EndParametersMsg) // not used
            return undefined;
        if (msg instanceof ContextProcedure.AddArgumentMsg) // not used
            return undefined;
        return ContextType.Record.prototype.handleMessage.call(this, msg);
    },
    doMakeField: function(field, type){
        return new EberonRecord.Field(field, type, this.type);
    },
    doGenerateBaseConstructorCallCode: function(){
        var base = this.type.base;
        if (!base)
            return "";
        var baseConstructor = EberonRecord.constructor$(base);
        if (!baseConstructor || !baseConstructor.args().length)
            return ContextType.Record.prototype.doGenerateBaseConstructorCallCode.call(this);
        
        return this.qualifiedBaseConstructor() + ".apply(this, arguments);\n";
    },
    endParse: function(){
        var type = this.type;
        if (!type.customConstructor)
            return ContextType.Record.prototype.endParse.call(this);

        this.codeGenerator().write(this.generateInheritance());
        type.setRecordInitializationCode(
            this.doGenerateBaseConstructorCallCode());
    }
});

var BaseInit = ChainedContext.extend({
    init: function EberonContext$BaseInit(parent){
        ChainedContext.prototype.init.call(this, parent);
        this.__type = undefined;
        this.__initCall = undefined;
        this.__initField = undefined;
    },
    type: function(){
        if (!this.__type)
            this.__type = this.handleMessage(new EberonContextProcedure.GetConstructorBoundTypeMsg());
        return this.__type;
    },
    codeGenerator: function(){return CodeGenerator.nullGenerator();},
    handleMessage: function(msg){
        if (msg instanceof ContextDesignator.BeginCallMsg)
            return;
        if (msg instanceof ContextDesignator.EndCallMsg){
            var e = this.__initCall.end();
            if (this.__initField)
                this.type().setFieldInitializationCode(this.__initField, e.code());
            else
                this.type().setBaseConstructorCallCode(e.code());
            return;
        }
        return ChainedContext.prototype.handleMessage.call(this, msg);
    },
    handleIdent: function(id){
        this.__initField = id;
        this.__initCall = this.handleMessage(new EberonContextProcedure.InitFieldMsg(id));
    },
    handleExpression: function(e){
        this.__initCall.handleArgument(e);
    },
    handleLiteral: function(s){
        if (s == "SUPER"){
            var ms = this.handleMessage(new EberonContextProcedure.GetConstructorSuperMsg());
            this.__initCall = makeContextCall(
                this,
                function(cx){ 
                    return EberonConstructor.makeBaseConstructorCall(
                        this.type().base, 
                        cx);
                    }.bind(this)
                );
        }
    }
});

var Factor = Class.extend.call(ContextExpression.Factor, {
    init: function EberonContext$Factor(context){
        ContextExpression.Factor.call(this, context);
    },
    handleLogicalNot: function(){
        ContextExpression.Factor.prototype.handleLogicalNot.call(this);
        var p = this.getCurrentPromotion();
        if (p)
            p.invert();
    },
    getCurrentPromotion: function(){
        return this.parent().getCurrentPromotion();
    }
});

var AddOperator = Class.extend.call(ContextExpression.AddOperator, {
    init: function EberonContext$AddOperator(context){
        ContextExpression.AddOperator.call(this, context);
    },
    doMatchPlusOperator: function(type){
        if (type == EberonString.string() || type instanceof Type.String)
            return eOp.addStr;
        return ContextExpression.AddOperator.prototype.doMatchPlusOperator.call(this, type);
    },
    doExpectPlusOperator: function(){return "numeric type or SET or STRING";},
    endParse: function(){
        this.parent().handleLogicalOr();
    }
});

var MulOperator = Class.extend.call(ContextExpression.MulOperator, {
    init: function EberonContext$MulOperator(context){
        ContextExpression.MulOperator.call(this, context);
    },
    endParse: function(s){
        this.parent().handleLogicalAnd();
    }
});

var RelationOps = Class.extend.call(ContextExpression.RelationOps, {
    init: function EberonContext$RelationOps(){
        ContextExpression.RelationOps.call(this);
    },
    eq: function(type){
        return type == EberonString.string() 
            ? eOp.equalStr
            : ContextExpression.RelationOps.prototype.eq.call(this, type);
    },
    notEq: function(type){
        return type == EberonString.string() 
            ? eOp.notEqualStr
            : ContextExpression.RelationOps.prototype.notEq.call(this, type);
    },
    less: function(type){
        return type == EberonString.string() 
            ? eOp.lessStr
            : ContextExpression.RelationOps.prototype.less.call(this, type);
    },
    greater: function(type){
        return type == EberonString.string() 
            ? eOp.greaterStr
            : ContextExpression.RelationOps.prototype.greater.call(this, type);
    },
    lessEq: function(type){
        return type == EberonString.string() 
            ? eOp.lessEqualStr
            : ContextExpression.RelationOps.prototype.lessEq.call(this, type);
    },
    greaterEq: function(type){
        return type == EberonString.string() 
            ? eOp.greaterEqualStr
            : ContextExpression.RelationOps.prototype.greaterEq.call(this, type);
    },
    is: function(context){
        var impl = ContextExpression.RelationOps.prototype.is.call(this, context);
        return function(left, right){
            var d = left.designator();
            if (d){
                var v = d.info();
                if (v instanceof EberonContextDesignator.TypeNarrowVariableBase)
                    context.handleMessage(new EberonContextDesignator.PromoteTypeMsg(v, ContextExpression.unwrapType(right.designator().info())));
            }
            return impl(left, right);
        };
    },
    coalesceType: function(leftType, rightType){
        if ((leftType == EberonString.string() && rightType instanceof Type.String)
            || (rightType == EberonString.string() && leftType instanceof Type.String))
            return EberonString.string();
        return ContextExpression.RelationOps.prototype.coalesceType.call(this, leftType, rightType);
    }
});

function BeginTypePromotionAndMsg(){
    this.result = undefined;
}

var Term = Class.extend.call(ContextExpression.Term, {
    init: function EberonContext$Term(context){
        ContextExpression.Term.call(this, context);
        this.__typePromotion = undefined;
        this.__currentPromotion = undefined;
        this.__andHandled = false;
    },
    handleMessage: function(msg){
        if (msg instanceof EberonContextDesignator.PromoteTypeMsg) {
            var promoted = msg.info;
            var p = this.getCurrentPromotion();
            if (p)
                p.promote(promoted, msg.type);
            return;
        }
        if (msg instanceof EberonContextProcedure.BeginTypePromotionOrMsg){
            var cp = this.getCurrentPromotion();
            if (cp)
                msg.result = cp.makeOr();
            return;
        }
        return ContextExpression.Term.prototype.handleMessage.call(this, msg);
    },
    handleLogicalAnd: function(){
        if (this.__typePromotion)
            this.__currentPromotion = this.__typePromotion.next();
        else
            this.__andHandled = true;
    },
    getCurrentPromotion: function(){
        if (!this.__currentPromotion){
            var msg = new BeginTypePromotionAndMsg();
            this.parent().handleMessage(msg);
            this.__typePromotion = msg.result;
            if (this.__typePromotion){
                if (this.__andHandled)
                    this.__typePromotion.next();
                this.__currentPromotion = this.__typePromotion.next();
            }
        }
        return this.__currentPromotion;
    }
});

var SimpleExpression = Class.extend.call(ContextExpression.SimpleExpression, {
    init: function EberonContext$SimpleExpression(context){
        ContextExpression.SimpleExpression.call(this, context);
        this.__typePromotion = undefined;
        this.__currentTypePromotion = undefined;
        this.__orHandled = false;
    },
    handleLogicalOr: function(){
        if (this.__typePromotion)
            this.__currentPromotion = this.__typePromotion.next();
        else
            this.__orHandled = true;
    },
    handleMessage: function(msg){
        if (msg instanceof BeginTypePromotionAndMsg){
            var p = this.__getCurrentPromotion();
            if (p)
                msg.result = p.makeAnd();
            return;
        }
        return ContextExpression.SimpleExpression.prototype.handleMessage.call(this, msg);
    },
    endParse: function(){
        if (this.__typePromotion)
            this.parent().handleTypePromotion(this.__typePromotion);
        ContextExpression.SimpleExpression.prototype.endParse.call(this);
    },
    __getCurrentPromotion: function(){
        if (!this.__currentPromotion){
            var msg = new EberonContextProcedure.BeginTypePromotionOrMsg();
            this.parent().handleMessage(msg);
            this.__typePromotion = msg.result;
            if (this.__typePromotion){
                if (this.__orHandled)
                    this.__typePromotion.next();
                this.__currentPromotion = this.__typePromotion.next();
            }
        }
        return this.__currentPromotion;
    }
});

var relationOps = new RelationOps();

var ExpressionContext = Class.extend.call(ContextExpression.ExpressionNode, {
    init: function EberonContext$Expression(context){
        ContextExpression.ExpressionNode.call(this, context, relationOps);
        this.__typePromotion = undefined;
        this.__currentTypePromotion = undefined;
    },
    handleMessage: function(msg){
        if (msg instanceof EberonContextDesignator.TransferPromotedTypesMsg)
            return;
        return ContextExpression.ExpressionNode.prototype.handleMessage.call(this, msg);
    },
    handleTypePromotion: function(t){
        this.__currentTypePromotion = t;
    },
    handleLiteral: function(s){
        if (this.__currentTypePromotion){
            this.__currentTypePromotion.clear();
        }
        ContextExpression.ExpressionNode.prototype.handleLiteral.call(this, s);
    },
    endParse: function(){
        if (this.__currentTypePromotion)
            this.parent().handleMessage(new EberonContextDesignator.TransferPromotedTypesMsg(this.__currentTypePromotion));
        return ContextExpression.ExpressionNode.prototype.endParse.call(this);
    },
    doRelationOperation: function(left, right, relation){
        if (relation == "IN" && right.type() instanceof EberonMap.Type){
            EberonContextDesignator.checkMapKeyType(left.type());
            return eOp.inMap;            
        }
        return ContextExpression.ExpressionNode.prototype.doRelationOperation.call(this, left, right, relation);
    }
});

var OperatorScopes = Class.extend({
    init: function EberonContext$OperatorScopes(context){
        this.__context = context;
        this.__scope = undefined;

        this.__typePromotion = undefined;
        this.__typePromotions = [];
        this.__ignorePromotions = false;
        this.alternate();
    },
    handleMessage: function(msg){
        if (this.__ignorePromotions)
            return false;
        if (msg instanceof EberonContextDesignator.TransferPromotedTypesMsg)
            return true;
        if (msg instanceof EberonContextDesignator.PromoteTypeMsg){
            this.__typePromotion = new TypePromotion.ForVariable(msg.info, msg.type);
            this.__typePromotions.push(this.__typePromotion);
            return true;
        }
        if (msg instanceof EberonContextProcedure.BeginTypePromotionOrMsg){
            this.__typePromotion = new TypePromotion.Or();
            this.__typePromotions.push(this.__typePromotion);
            msg.result = this.__typePromotion;
            return true;
        }
        return false;
    },
    doThen: function(){
        if (this.__typePromotion)
            this.__typePromotion.and();
        this.__ignorePromotions = true;
    },
    alternate: function(){
        var root = this.__context.root();
        if (this.__scope)
            root.popScope();
        this.__scope = EberonScope.makeOperator(
            root.currentScope(),
            root.language().stdSymbols);
        root.pushScope(this.__scope);

        if (this.__typePromotion){
            this.__typePromotion.reset();
            this.__typePromotion.or();
            this.__typePromotion = undefined;
        }
        this.__ignorePromotions = false;
    },
    reset: function(){
        this.__context.root().popScope();
        for(var i = 0; i < this.__typePromotions.length; ++i){
            this.__typePromotions[i].reset();
        }
    }
});

var While = Class.extend.call(ContextLoop.While, {
    init: function EberonContext$While(context){
        ContextLoop.While.call(this, context);
        this.__scopes = new OperatorScopes(this);
    },
    handleLiteral: function(s){
        ContextLoop.While.prototype.handleLiteral.call(this, s);
        if (s == "DO")
            this.__scopes.doThen();
        else if (s == "ELSIF")
            this.__scopes.alternate();
    },
    handleMessage: function(msg){
        if (this.__scopes.handleMessage(msg))
            return;

        return ContextLoop.While.prototype.handleMessage.call(this, msg);
    },
    endParse: function(){
        this.__scopes.reset();
        ContextLoop.While.prototype.endParse.call(this);
    }
});

var If = Class.extend.call(ContextIf.Type, {
    init: function EberonContext$If(context){
        ContextIf.Type.call(this, context);
        this.__scopes = new OperatorScopes(this);
    },
    handleMessage: function(msg){
        if (this.__scopes.handleMessage(msg))
            return;

        return ContextIf.Type.prototype.handleMessage.call(this, msg);
    },
    handleLiteral: function(s){
        ContextIf.Type.prototype.handleLiteral.call(this, s);
        if (s == "THEN")
            this.__scopes.doThen();
        else if (s == "ELSIF" || s == "ELSE")
            this.__scopes.alternate();
    },
    endParse: function(){
        this.__scopes.reset();
        ContextIf.Type.prototype.endParse.call(this);
    }
});

var CaseLabel = Class.extend.call(ContextCase.Label, {
    init: function EberonContext$CaseLabel(context){
        ContextCase.Label.call(this, context);
    },
    handleLiteral: function(s){
        if (s == ':'){ // statement sequence is expected now
            var root = this.root();
            var scope = EberonScope.makeOperator(
                root.currentScope(),
                root.language().stdSymbols);
            root.pushScope(scope);
        }
    },
    endParse: function(){
        this.root().popScope();
        ContextCase.Label.prototype.endParse.call(this);
    }
});

var Repeat = Class.extend.call(ContextLoop.Repeat, {
    init: function EberonContext$Repeat(context){
        ContextLoop.Repeat.call(this, context);
        var root = this.root();
        var scope = EberonScope.makeOperator(
            root.currentScope(),
            root.language().stdSymbols);
        root.pushScope(scope);
    },
    endParse: function(){
        this.root().popScope();
        //Context.Repeat.prototype.endParse.call(this);
    }
});

var For = Class.extend.call(ContextLoop.For, {
    init: function EberonContext$Repeat(context){
        ContextLoop.For.call(this, context);
        var root = this.root();
        var scope = EberonScope.makeOperator(
            root.currentScope(),
            root.language().stdSymbols);
        root.pushScope(scope);
    },
    handleInPlaceInit: function(symbol, code){
        this.doHandleInitCode(symbol.id(), "for (" + code);
        this.doHandleInitExpression(symbol.info().type());
    },
    endParse: function(){
        this.root().popScope();
        ContextLoop.For.prototype.endParse.call(this);
    }
});

var dynamicArrayLength = -1;

var ArrayDimensions = Class.extend.call(ContextType.ArrayDimensions, {
    init: function EberonContext$ArrayDimensions(context){
        ContextType.ArrayDimensions.call(this, context);
    },
    handleLiteral: function(s){
        if ( s == "*" )
            this.doAddDimension(dynamicArrayLength);
        else
            ContextType.ArrayDimensions.prototype.handleLiteral.call(this, s);
    }
});

var MapDecl = ChainedContext.extend({
    init: function EberonContext$MapDecl(context){
        ChainedContext.prototype.init.call(this, context);
        this.__type = undefined;
    },
    handleQIdent: function(q){
        var s = ContextHierarchy.getQIdSymbolAndScope(this.root(), q);
        var type = ContextExpression.unwrapType(s.symbol().info());
        this.setType(type);
    },
    // anonymous types can be used in map declaration
    setType: function(type){
        this.__type = type;
    },
    isAnonymousDeclaration: function(){return true;},
    typeName: function(){return "";},
    endParse: function(){
        this.parent().setType(new EberonMap.Type(this.__type));
    }
});

var ForEach = ChainedContext.extend({
    init: function EberonContext$MapDecl(context){
        ChainedContext.prototype.init.call(this, context);
        this.__valueId = undefined;
        this.__keyId = undefined;
        this.__scopeWasCreated = false;
        this.__codeGenerator = CodeGenerator.nullGenerator();
    },
    handleIdent: function(id){
        if (!this.__keyId)
                this.__keyId = id;
            else
                this.__valueId = id;
    },
    codeGenerator: function(){return this.__codeGenerator;},
    handleExpression: function(e){
        var type = e.type();
        if (!(type instanceof EberonMap.Type))
            throw new Errors.Error("expression of type MAP is expected in FOR, got '" 
                                 + type.description() + "'");

        var root = this.root();
        var scope = EberonScope.makeOperator(
            root.currentScope(),
            root.language().stdSymbols);
        root.pushScope(scope);
        this.__scopeWasCreated = true;

        var code = this.parent().codeGenerator();
        var mapVar = root.currentScope().generateTempVar("map");
        code.write("var " + mapVar + " = " + e.code() + ";\n");
        code.write("for(var " + this.__keyId + " in " + mapVar + ")");
        code.openScope();
        code.write("var " + this.__valueId + " = " + mapVar + "[" + this.__keyId + "];\n");
        this.__codeGenerator = code;

        this.__makeVariable(this.__keyId, EberonString.string(), scope);
        this.__makeVariable(this.__valueId, type.valueType, scope);
    },
    endParse: function(){
        this.__codeGenerator.closeScope("");
        if (this.__scopeWasCreated)
            this.root().popScope();
    },
    __makeVariable: function(id, type, scope){
        var v = new ForEachVariable(type);
        var s = new Symbol.Symbol(id, v);
        scope.addSymbol(s);
        return s;
    }
});

var ArrayDecl = Class.extend.call(ContextType.Array, {
    init: function EberonContext$ArrayDecl(context){
        ContextType.Array.call(this, context);
    },
    doMakeInit: function(type, dimensions, length){
        if (length == dynamicArrayLength)
            return '[]';

        if (type instanceof EberonRecord.Record && EberonRecord.hasParameterizedConstructor(type))
            throw new Errors.Error("cannot use '" + Type.typeName(type) + "' as an element of static array because it has constructor with parameters");

        return ContextType.Array.prototype.doMakeInit.call(this, type, dimensions, length);
    },
    doMakeType: function(elementsType, init, length){
        return length == dynamicArrayLength
            ? new EberonDynamicArray.DynamicArray(elementsType)
            : ContextType.Array.prototype.doMakeType.call(this, elementsType, init, length);
    }
});

function assertArgumentIsNotNonVarDynamicArray(msg){
    if (msg instanceof ContextProcedure.AddArgumentMsg){
        var arg = msg.arg;
        if (!arg.isVar){
            var type = arg.type;
            while (type instanceof Type.Array){
                if (type instanceof EberonDynamicArray.DynamicArray)
                    throw new Errors.Error("dynamic array has no use as non-VAR argument '" + msg.name + "'");
                type = type.elementsType;
            }
        }
    }
}

var FormalParameters = Class.extend.call(ContextProcedure.FormalParameters, {
    init: function EberonContext$FormalParameters(context){
        ContextProcedure.FormalParameters.call(this, context);
    },
    handleMessage: function(msg){
        assertArgumentIsNotNonVarDynamicArray(msg);
        return ContextProcedure.FormalParameters.prototype.handleMessage.call(this, msg);
    },
    doCheckResultType: function(type){
        if (type instanceof EberonDynamicArray.DynamicArray)
            return;
        ContextProcedure.FormalParameters.prototype.doCheckResultType.call(this, type);
    }
});

var FormalType = Class.extend.call(ContextType.HandleSymbolAsType, {
    init: function EberonContext$FormalType(context){
        ContextType.HandleSymbolAsType.call(this, context);
        this.__arrayDimensions = [];
        this.__dynamicDimension = false;
    },
    setType: function(type){           
        function makeDynamic(type){return new EberonDynamicArray.DynamicArray(type); }

        for(var i = this.__arrayDimensions.length; i--;){
            var cons = this.__arrayDimensions[i]
                ? makeDynamic
                : this.root().language().types.makeOpenArray;
            type = cons(type);
        }
        this.parent().setType(type);
    },
    handleLiteral: function(s){
        if (s == "*")
            this.__dynamicDimension = true;
        else if ( s == "OF"){
            this.__arrayDimensions.push(this.__dynamicDimension);
            this.__dynamicDimension = false;
        }
    }
});

var FormalParametersProcDecl = Class.extend.call(ContextProcedure.FormalParametersProcDecl, {
    init: function EberonContext$FormalParametersProcDecl(context){
        ContextProcedure.FormalParametersProcDecl.call(this, context);
    },
    handleMessage: function(msg){
        assertArgumentIsNotNonVarDynamicArray(msg);
        return ContextProcedure.FormalParametersProcDecl.prototype.handleMessage.call(this, msg);
    },
    doCheckResultType: function(type){
        if (type instanceof EberonDynamicArray.DynamicArray)
            return;
        ContextProcedure.FormalParametersProcDecl.prototype.doCheckResultType.call(this, type);
    }
});

var ModuleDeclaration = Class.extend.call(ContextModule.Declaration, {
    init: function EberonContext$ModuleDeclaration(context){
        ContextModule.Declaration.call(this, context);
    },
    handleMessage: function(msg){
        if (EberonContextProcedure.handleTypePromotionMadeInSeparateStatement(msg))
            return;
        return ContextModule.Declaration.prototype.handleMessage.call(this, msg);
    }
});

exports.AddOperator = AddOperator;
exports.ArrayDecl = ArrayDecl;
exports.ArrayDimensions = ArrayDimensions;
exports.BaseInit = BaseInit;
exports.CaseLabel = CaseLabel;
exports.ConstDecl = ConstDecl;
exports.Expression = ExpressionContext;
exports.ExpressionProcedureCall = ExpressionProcedureCall;
exports.For = For;
exports.ForEach = ForEach;
exports.FormalParameters = FormalParameters;
exports.FormalParametersProcDecl = FormalParametersProcDecl;
exports.FormalType = FormalType;
exports.Identdef = Identdef;
exports.If = If;
exports.MethodHeading = MethodHeading;
exports.ModuleDeclaration = ModuleDeclaration;
exports.MulOperator = MulOperator;
exports.AssignmentOrProcedureCall = AssignmentOrProcedureCall;
exports.Factor = Factor;
exports.MapDecl = MapDecl;
exports.ProcOrMethodId = ProcOrMethodId;
exports.RecordDecl = RecordDecl;
exports.Repeat = Repeat;
exports.SimpleExpression = SimpleExpression;
exports.InPlaceVariableInit = InPlaceVariableInit;
exports.InPlaceVariableInitFor = InPlaceVariableInitFor;
exports.OperatorNew = OperatorNew;
exports.Term = Term;
exports.TypeDeclaration = TypeDeclaration;
exports.VariableDeclaration = VariableDeclaration;
exports.While = While;
