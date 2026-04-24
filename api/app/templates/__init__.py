from .jakes import JAKES

_REGISTRY = {JAKES["id"]: JAKES}

def list_templates():
    return [{"id": t["id"], "name": t["name"]} for t in _REGISTRY.values()]

def get_template(template_id: str):
    return _REGISTRY[template_id]
