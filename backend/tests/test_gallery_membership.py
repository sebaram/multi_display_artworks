"""Legacy parent lists define gallery membership even when reverse links are stale."""
from types import SimpleNamespace
import pytest

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


def test_geometry_checks_supplied_display_wall_bounds_without_a_reverse_link():
    from fastapi import HTTPException
    from metamuseum import models as m
    element = m.Image(name='listed', description='legacy', image_url='/static/image/example.jpg',
                      width=1, height=1, position='2 0 0', position_x=2, position_y=0)
    gallery.validate_geometry(element, element_walls=[SimpleNamespace(width=10, height=10)])
    with pytest.raises(HTTPException) as raised:
        gallery.validate_geometry(element, element_walls=[SimpleNamespace(width=1, height=1)])
    assert raised.value.status_code == 422
