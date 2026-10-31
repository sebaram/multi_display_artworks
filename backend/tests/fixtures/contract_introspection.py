"""Source-only HTTP/socket contract extraction, independent of Flask imports."""
import ast

def _input_value(node):
    expression=ast.unparse(node)
    return expression.startswith('request.') or expression in ('data','auth') or expression.startswith(('data[','data.','auth[','auth.'))

def input_contract(source):
    tree=ast.parse(source)
    expressions=set()
    fields=set()
    loop_fields={node.target.id:[value.value for value in node.iter.elts if isinstance(value,ast.Constant) and isinstance(value.value,str)] for node in ast.walk(tree) if isinstance(node,ast.For) and isinstance(node.target,ast.Name) and isinstance(node.iter,(ast.List,ast.Tuple))}
    for node in ast.walk(tree):
        if isinstance(node,ast.Attribute) and _input_value(node):
            expressions.add(ast.unparse(node))
        elif isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and _input_value(node.func):
            expressions.add(ast.unparse(node))
            if node.func.attr=='get' and node.args and isinstance(node.args[0],ast.Constant) and isinstance(node.args[0].value,str):fields.add(node.args[0].value)
        elif isinstance(node,ast.Subscript) and _input_value(node.value):
            expressions.add(ast.unparse(node))
            if isinstance(node.slice,ast.Constant) and isinstance(node.slice.value,str):fields.add(node.slice.value)
            elif isinstance(node.slice,ast.Name):fields.update(loop_fields.get(node.slice.id,[]))
        elif isinstance(node,ast.Compare) and any(isinstance(operator,(ast.In,ast.NotIn)) for operator in node.ops) and any(_input_value(value) for value in node.comparators):
            expressions.add(ast.unparse(node))
            if isinstance(node.left,ast.Constant) and isinstance(node.left.value,str):fields.add(node.left.value)
            elif isinstance(node.left,ast.Name):fields.update(loop_fields.get(node.left.id,[]))
    return sorted(expressions),sorted(fields)

def auth_policy(source,endpoint,path):
    if endpoint=='static' or endpoint.endswith('.static'):
        return 'public static file'
    if path.startswith('/kwanri'):
        return 'admin session; otherwise 302 signin?next=<request.url>'
    tree=ast.parse(source)
    decorators=[ast.unparse(value) for node in tree.body if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) for value in node.decorator_list]
    if any(value=='admin_required' for value in decorators):return 'admin session; JSON 403'
    if any(value=='login_required' for value in decorators):return 'authenticated; redirect signin'
    if any(isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='require_admin' for node in ast.walk(tree)):
        return 'admin helper require_admin; JSON 403'
    if 'current_user.is_admin' in source and '403' in source:return 'inline admin check; JSON 403'
    return 'public'
