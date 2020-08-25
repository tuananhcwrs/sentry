from __future__ import absolute_import

from time import time
import pytest
import uuid
import six

from sentry import eventstore
from sentry.event_manager import EventManager
from sentry.eventstore.processing import event_processing_store
from sentry.plugins.base.v2 import Plugin2
from sentry.tasks.reprocessing2 import reprocess_group
from sentry.tasks.store import preprocess_event
from sentry.testutils.helpers import Feature
from sentry.testutils.helpers.datetime import iso_format, before_now


@pytest.mark.django_db
@pytest.mark.parametrize("change_groups", (True, False))
def test_basic(task_runner, default_project, register_plugin, change_groups, reset_snuba):
    # Replace this with an int and nonlocal when we have Python 3
    abs_count = []

    def event_preprocessor(data):
        tags = dict(data.get("tags") or ())
        assert "processing_counter" not in tags
        tags["processing_counter"] = "x{}".format(len(abs_count))
        abs_count.append(None)

        data["tags"] = list(six.iteritems(tags))

        if change_groups:
            data["fingerprint"] = [uuid.uuid4().hex]
        else:
            data["fingerprint"] = ["foo"]

        return data

    class ReprocessingTestPlugin(Plugin2):
        def get_event_preprocessors(self, data):
            return [event_preprocessor]

        def is_enabled(self, project=None):
            return True

    register_plugin(globals(), ReprocessingTestPlugin)

    mgr = EventManager(
        data={"timestamp": iso_format(before_now(seconds=1))}, project=default_project
    )
    mgr.normalize()
    data = mgr.get_data()
    event_id = data["event_id"]
    cache_key = event_processing_store.store(data)

    def get_nodestore_event():
        return eventstore.get_event_by_id(default_project.id, event_id)

    def get_event_by_processing_counter(n):
        return list(
            eventstore.get_events(
                eventstore.Filter(
                    project_ids=[default_project.id],
                    conditions=[["tags[processing_counter]", "=", n]],
                )
            )
        )

    def get_event_by_group(n):
        return list(
            eventstore.get_events(
                eventstore.Filter(project_ids=[default_project.id], group_ids=[n])
            )
        )

    with task_runner(), Feature({"projects:reprocessing-v2": True}):
        # factories.store_event would almost be suitable for this, but let's
        # actually run through stacktrace processing once
        preprocess_event(start_time=time(), cache_key=cache_key, data=data)

    event = get_nodestore_event()
    assert dict(event.data["tags"])["processing_counter"] == "x0"
    assert not event.data.get("errors")

    assert get_event_by_processing_counter("x0")[0].event_id == event.event_id
    assert get_event_by_group(event.group_id)[0].event_id == event.event_id

    old_event = event

    with task_runner(), Feature({"projects:reprocessing-v2": True}):
        reprocess_group(default_project.id, event.group_id)

    (event,) = get_event_by_processing_counter("x1")
    # Assert original data is used
    assert dict(event.data["tags"])["processing_counter"] == "x1"
    assert not event.data.get("errors")

    assert event.group_id != old_event.group_id
