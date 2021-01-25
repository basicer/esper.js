'use strict';
/* @flow */

const Value = require('../Value');
const PropertyDescriptor = require('./PropertyDescriptor');
const ObjectValue = require('./ObjectValue');
const ArrayValue = require('./ArrayValue');
const EvaluatorInstruction = require('../EvaluatorInstruction');
let EvaluatorHandlers;


/**
 * Represents a value that maps directly to an untrusted local value.
 */
class ClosureValue extends ObjectValue {

	/**
	 * @param {object} func - AST Node for function
	 * @param {Scope} scope - Functions up-values.
	 */
	constructor(func, scope) {
		let realm = scope.realm;
		super(realm, realm.FunctionPrototype);
		this.func = func;
		this.funcSourceAST = func;
		this.scope = scope;
		this.returnLastValue = false;
		this.properties['prototype'] = new PropertyDescriptor(new ObjectValue(realm), false);
		this.properties['name'] = new PropertyDescriptor(realm.fromNative(func.id ? func.id.name : undefined), false);
		this.properties['length'] = new PropertyDescriptor(realm.fromNative(func.params.length), false);
	}

	toNative() {
		return Value.createNativeBookmark(this, this.scope.realm);
	}

	get debugString() {
		if ( this.func && this.func.id ) return `[Function ${this.func.id.name}]`;
		return '[Function]';
	}

	get truthy() {
		return true;
	}

	*doubleEquals(other) {
		return other === this ? Value.true : Value.false;
	}

	/**
	 *
	 * @param {Value} thiz
	 * @param {Value[]} args
	 * @param {Scope} scope
	 */
	*call(thiz, args, scope, extra) {
		//TODO: This way of scoping is entirelly wrong.
		if ( !scope ) scope = this.scope;
		let invokeScope;
		if ( this.boundScope ) {
			invokeScope = this.boundScope.createChild();
			invokeScope.writeTo = this.boundScope.object;
			invokeScope.thiz = this.thiz || /* thiz ||*/ this.boundScope.thiz;
		} else {
			invokeScope = this.scope.createChild();
			invokeScope.thiz = this.thiz || thiz;
		}

		if ( this.func.strict === true ) invokeScope.strict = true;

		if ( this.func.id ) {
			invokeScope.add(this.func.id.name, this);
		}

		let obj = this.scope.object;
		/*
		if ( this.func.upvars ) {
			for ( let n in this.func.upvars ) {
				//TODO: There should be a method that does this.
				invokeScope.object.rawSetProperty(n, obj.properties[n]);
			}
		}
		*/

		//Do Var Hoisting
		if ( this.func.vars ) {
			for ( let v in this.func.vars ) {
				invokeScope.add(v, Value.undef);
				invokeScope.object.properties[v].isVariable = true;
			}
		}

		/*
		if ( this.func.funcs ) {
			for ( let fn in this.func.funcs ) {
				let n = this.func.funcs[fn];
				let closure = new ClosureValue(n, scope);
				invokeScope.add(n.id.name, closure);
			}
		}
		*/

		// Just a total guess that this is correct behavior...
		if ( !invokeScope.strict && this.func.funcs ) {
			for ( let fn in this.func.funcs ) {
				let n = this.func.funcs[fn];
				invokeScope.add(n.id.name, Value.undef);
			}
		}

		let argn = Math.max(args.length, this.func.params.length);
		let argvars = new Array(argn);
		let argsObj = new ObjectValue(invokeScope.realm);
		argsObj.clazz = 'Arguments';

		for ( let i = 0; i < argn; ++i ) {
			let vv = Value.undef;
			if ( i < args.length ) vv = args[i];

			let v = new PropertyDescriptor(vv);
			argvars[i] = v;

			if ( invokeScope.strict ) {
				yield * argsObj.set(i, vv);
			} else {
				argsObj.rawSetProperty(i, v);
			}
		}

		if ( !invokeScope.strict ) {
			let calleeProp = new PropertyDescriptor(invokeScope.realm.fromNative(args.length));
			calleeProp.enumerable = false;
			argsObj.rawSetProperty('callee', calleeProp);
			yield * argsObj.set('callee', this);
		}

		let lengthProp = new PropertyDescriptor(invokeScope.realm.fromNative(args.length));
		lengthProp.enumerable = false;
		argsObj.rawSetProperty('length', lengthProp);

		invokeScope.add('arguments', argsObj);


		for ( let i = 0; i < this.func.params.length; ++i ) {
			let p = this.func.params[i];
			let def = false;

			if ( p.type === "AssignmentPattern" ) {
				def = p.right;
				p = p.left;
			}
			if ( p.type === 'RestElement' ) {
				let name = this.func.params[i].argument.name;
				let rest = args.slice(i);
				invokeScope.add(name, ArrayValue.make(rest, scope.realm));
			} else {
				if ( p.type === "Identifier" ) {
					p = {id: p};
					if (!p.id) console.log("Wrong P", Object.keys(this.func.vars), p);
					let name = p.id ? p.id.name : undefined;

					let val = Value.undef;

					if (i < args.length) {
						val = args[i];
					} else if (def) {
						val = yield * extra.evaluator.branch(def, scope);
						argvars[i].value = val;
					}

					if ( scope.strict ) {
						//Scope is strict, so we make a copy for the args variable
						invokeScope.add(name, val);
					} else {
						//Scope isnt strict, magic happens.
						invokeScope.object.rawSetProperty(name, argvars[i]);
					}
				} else {
					let ref = yield * EvaluatorHandlers.doResolveRef(p, invokeScope);
					yield * ref.setValue( args.length ? args[i] : def);
				}
			}
		}
		let opts = {returnLastValue: this.returnLastValue, creator: this};
		if ( extra && extra.evaluator && extra.evaluator.debug ) {
			opts['profileName'] = extra.callNode.callee.srcName;
		}
		if ( extra && extra.callee ) {
			opts.callee = extra.callee;
		}
		if ( this.func.nonUserCode ) {
			opts.yieldPower = -1;
		}

		var result = yield EvaluatorInstruction.branch('function', this.func.body, invokeScope, opts);
		return result;
	}

	get jsTypeName() { return 'function'; }
	get specTypeName() { return 'object'; }

}
ClosureValue.prototype.clazz = 'Function';

module.exports = ClosureValue;

EvaluatorHandlers = require('../EvaluatorHandlers');
