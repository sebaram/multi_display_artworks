"""Legacy parent lists define gallery membership even when reverse links are stale."""
from types import SimpleNamespace

from bson import DBRef, ObjectId

from metamuseum.services import gallery


def test_ordered_membership_keeps_listed_children_with_missing_reverse_links():
    parent = SimpleNamespace(_data={"gltfs": []})
    first = SimpleNamespace(pk=ObjectId(), wall=None)
    second = SimpleNamespace(pk=ObjectId(), wall="another-wall")
    unlisted = SimpleNamespace(pk=ObjectId(), wall=parent)
    parent._data["gltfs"] = [DBRef("g_l_t_fmodel", second.pk), DBRef("g_l_t_fmodel", first.pk)]

    class Children:
        @staticmethod
        def objects(**query):
            if "pk__in" in query:
                return [child for child in (first, unlisted, second) if child.pk in query["pk__in"]]
            return [unlisted]

    assert gallery.ordered_documents(parent, "gltfs", Children) == [second, first]


def test_empty_parent_list_does_not_import_forward_only_children():
    parent = SimpleNamespace(_data={"walls": []})

    class Children:
        @staticmethod
        def objects(**query):
            return [] if "pk__in" in query else [SimpleNamespace(pk=ObjectId(), room=parent)]

    assert gallery.ordered_documents(parent, "walls", Children) == []


def test_membership_accepts_dereferenced_documents_and_preserves_duplicate_order():
    child = SimpleNamespace(pk=ObjectId())
    parent = SimpleNamespace(_data={"images": [child, child, DBRef("image", ObjectId())]})
    model = SimpleNamespace(objects=lambda **query: [child])
    assert gallery.ordered_documents(parent, "images", model) == [child, child]
