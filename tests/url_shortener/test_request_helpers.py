"""Tests for request helper functions."""

import json

import pytest

from app.request_helpers import normalize_details


def test_normalize_details_none():
    assert normalize_details(None) == "{}"


def test_normalize_details_dict():
    result = normalize_details({"key": "value"})
    assert json.loads(result) == {"key": "value"}


def test_normalize_details_list():
    result = normalize_details([1, 2, 3])
    assert json.loads(result) == [1, 2, 3]


def test_normalize_details_json_string_dict():
    result = normalize_details('{"a": 1}')
    assert json.loads(result) == {"a": 1}


def test_normalize_details_json_string_list():
    result = normalize_details("[1, 2]")
    assert json.loads(result) == [1, 2]


def test_normalize_details_plain_string_raises():
    with pytest.raises(ValueError, match="JSON object or array"):
        normalize_details("just a string")


def test_normalize_details_json_string_number_raises():
    with pytest.raises(ValueError, match="JSON object or array"):
        normalize_details("42")


def test_normalize_details_number_raises():
    with pytest.raises(ValueError, match="JSON object or array"):
        normalize_details(42)


def test_normalize_details_boolean_raises():
    with pytest.raises(ValueError, match="JSON object or array"):
        normalize_details(True)
