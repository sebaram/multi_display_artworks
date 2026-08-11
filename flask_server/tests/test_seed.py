"""Seed integration tests; these intentionally run against real MongoDB."""


def test_seed_creates_data_in_real_database():
    from metamuseum.elements.basic import Room
    from seed_and_serve import seed

    seed()
    assert Room.objects.count() == 3
