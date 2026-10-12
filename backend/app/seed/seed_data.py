"""World seed data - Kaduna city map (OSM-derived, stylized).

The layout follows the real geography of Kaduna: River Kaduna, Ahmadu
Bello Way, the Central Market, Murtala Square, Barnawa, Kakuri, Kawo,
Rigasa, the airport and the rest of the city (see scripts/kaduna-osm/).
Coordinates are the local Three.js system (1 unit = 10 m, origin at
Murtala Square) - approximate, manually reconciled with OSM data.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import NPCAgent
from app.models.business import Business, ShopListing
from app.models.catalog import Item
from app.models.jobs import Job
from app.core.config import settings
from app.models.player import PlayerState, User
from app.models.world import WorldEntity, WorldRegion

ITEMS = [
    ("suya_spice", "Suya Spice", "food", "Yaji spice mix - the good one from the mallam.", "\U0001f9c2"),
    ("fura_nono", "Fura da Nono", "food", "Millet and fermented milk, chilled. Kaduna classic.", "\U0001f95b"),
    ("zobo_concentrate", "Zobo Concentrate", "food", "Hibiscus concentrate. Add water, ice, ginger.", "\U0001f379"),
    ("kuli_kuli", "Kuli Kuli", "food", "Groundnut snack, crunchy, dangerously addictive.", "\U0001f95c"),
    ("ankara_fabric", "Ankara Fabric", "fashion", "Six yards of premium Ankara print.", "\U0001f455"),
    ("power_bank", "Solar Power Bank", "electronics", "20,000mAh - NEPA wahala survival kit.", "\U0001f50b"),
    ("phone_charger", "Fast Charger", "electronics", "65W GaN charger. No time to waste.", "\U0001f50c"),
    ("quest_parcel", "Sealed Package", "quest", "A sealed package for delivery. Do not shake.", "\U0001f4e6"),
]

ENTITIES = [
    # code, name, type, raw x, raw z (bake units, scaled by
    # settings.world_scale when written), rotation, radius (meters)
    ("spawn_roadside", "Ahmadu Bello Way - Roadside Spawn", "spawn", -60.667, 85.483, 0.0, 8.0),
    ("musa_shop", "Musa's Provision Store", "shop", -49.333, 80.183, 0.4, 10.0),
    ("arewa_pos", "Arewa QuickPOS Kiosk", "pos_kiosk", -34.667, -2.683, 0.0, 6.0),
    ("kaduna_central_market", "Kaduna Central Market", "market", -70.0, 98.0, -0.5, 14.0),
    ("arewa_house", "Arewa House", "landmark", -34.667, -144.45, 0.9, 10.0),
    ("stonetech_square", "Stonetech Square, Barnawa", "landmark", -42.0, 350.0, -0.4, 10.0),
    ("keke_stop", "Keke Napep Stop, Kaduna Junction", "transport_stop", -245.0, 417.05, 0.2, 8.0),
    ("npc_musa", "Mallam Musa", "npc", -50.5, 82.583, 0.5, 4.0),
    ("npc_amina", "Hajiya Amina", "npc", -43.667, 349.333, -0.3, 4.0),
]

SHOP_LISTINGS = [
    # item_code, stock, ngn_minor, sats
    ("suya_spice", 24, 350_000, 1500),
    ("fura_nono", 16, 480_000, 2000),
    ("zobo_concentrate", 30, 290_000, 1200),
    ("kuli_kuli", 40, 190_000, 800),
    ("ankara_fabric", 10, 1_100_000, 4500),
    ("power_bank", 6, 2_200_000, 9000),
    ("phone_charger", 12, 850_000, 3500),
]

SHOPKEEPER_TOOLS = [
    "get_business_status",
    "check_inventory",
    "get_market_prices",
    "get_customer_context",
    "list_available_jobs",
    "create_delivery_job",
    "set_price_within_limits",
    "record_customer_interaction",
]


async def reconcile_world_scale(db: AsyncSession) -> int:
    """Move seeded entities to their positions at the current world scale.

    Idempotent: databases created before the WORLD_SCALE change (or with a
    different scale) are healed on boot. Players stranded outside the new
    city rectangle, or whose saved spot is now open ground between the old
    and new layout, are sent back to the spawn. Returns the number of rows
    changed."""
    k = settings.world_scale
    changed = 0
    spawn = None
    for code, _name, _etype, x, z, _rot, _radius in ENTITIES:
        e = (await db.execute(select(WorldEntity).where(WorldEntity.code == code))).scalar_one_or_none()
        if e is None:
            continue
        tx, tz = x * k, z * k
        if abs(e.position_x - tx) > 0.01 or abs(e.position_z - tz) > 0.01:
            e.position_x, e.position_z = tx, tz
            changed += 1
        if code == "spawn_roadside":
            spawn = (tx, tz)
    if changed and spawn is not None:
        # entities moved => old saved player positions belong to the old
        # scale; put everyone back on Ahmadu Bello Way
        for ps in (await db.execute(select(PlayerState))).scalars().all():
            ps.position_x, ps.position_y, ps.position_z = spawn[0], 0.0, spawn[1]
            changed += 1
    if changed:
        await db.commit()
    return changed


async def seed_if_empty(db: AsyncSession) -> bool:
    if (await db.execute(select(func.count()).select_from(WorldRegion))).scalar_one() > 0:
        return False

    region = WorldRegion(
        name="Kaduna City",
        slug="kaduna-city",
        description="The full city map: River Kaduna, Ahmadu Bello Way, "
        "Murtala Square, Kaduna Central Market, Barnawa, Kakuri, Kawo, "
        "Rigasa, the airport and more. Manually modeled, approximate layout "
        "reconciled with OpenStreetMap - not survey data.",
        map_metadata={"attribution": "Layout derived from OpenStreetMap data; "
                      "\u00a9 OpenStreetMap contributors (ODbL). Game geometry is approximate."},
    )
    db.add(region)
    await db.flush()

    entity_map: dict[str, WorldEntity] = {}
    for code, name, etype, x, z, rot, radius in ENTITIES:
        e = WorldEntity(
            region_id=region.id, code=code, name=name, entity_type=etype,
            position_x=x * settings.world_scale, position_y=0.0,
            position_z=z * settings.world_scale, rotation=rot,
            interaction_radius=radius, metadata_json={},
        )
        db.add(e)
        entity_map[code] = e
    await db.flush()

    items: dict[str, Item] = {}
    for code, name, itype, desc, emoji in ITEMS:
        item = Item(code=code, name=name, item_type=itype, description=desc, emoji=emoji)
        db.add(item)
        items[code] = item
    await db.flush()

    musa_shop = entity_map["musa_shop"]
    arewa_pos = entity_map["arewa_pos"]

    biz_musa = Business(
        code="musa_provision_store", name="Musa's Provision Store",
        owner_type="npc", owner_id=None, business_type="shop",
        entity_id=musa_shop.id, status="open",
        metadata_json={"tagline": "Everything you need, since 1998"},
    )
    db.add(biz_musa)
    biz_pos = Business(
        code="arewa_quickpos", name="Arewa QuickPOS",
        owner_type="system", owner_id=None, business_type="pos",
        entity_id=arewa_pos.id, status="open",
        metadata_json={"tagline": "Lightning-powered point of service"},
    )
    db.add(biz_pos)
    await db.flush()

    for item_code, stock, ngn_minor, sats in SHOP_LISTINGS:
        db.add(
            ShopListing(
                business_id=biz_musa.id, item_id=items[item_code].id,
                quantity_available=stock, price_ngn_minor=ngn_minor,
                price_sats=sats, is_active=True,
            )
        )

    musa_persona = (
        "A practical Kaduna neighborhood shopkeeper who understands stock, "
        "customer needs, delivery jobs, and local business conditions. Warm, "
        "witty, mixes Hausa-flavored Nigerian English. Business-minded but honest. "
        "He knows Bitcoin Lightning lets customers pay with real sats, but he "
        "cannot touch anyone's wallet - the payment system handles settlement."
    )
    db.add(
        NPCAgent(
            code="kaduna_shopkeeper_001", name="Mallam Musa", persona=musa_persona,
            world_entity_id=entity_map["npc_musa"].id, business_id=biz_musa.id,
            agent_type="shopkeeper", allowed_tools=SHOPKEEPER_TOOLS,
            configuration={"interaction_log": []}, status="active",
        )
    )
    db.add(
        NPCAgent(
            code="stonetech_recipient_001", name="Hajiya Amina",
            persona="Stonetech Square coordinator who receives market deliveries. "
            "Brief, friendly, always checking her list.",
            world_entity_id=entity_map["npc_amina"].id, business_id=None,
            agent_type="recipient", allowed_tools=[],
            configuration={"interaction_log": []}, status="active",
        )
    )

    db.add(
        Job(
            code="deliv-musa-stonetech-0001", job_type="delivery",
            title="Deliver Suya Spice to Stonetech Square",
            description="Collect a sealed package from Musa's Provision Store "
            "and deliver it to Hajiya Amina at Stonetech Square.",
            issuer_business_id=biz_musa.id, status="available",
            pickup_entity_id=musa_shop.id, dropoff_entity_id=entity_map["stonetech_square"].id,
            reward_ngn_minor=8_000_00, reward_reputation=5,
        )
    )

    # a demo account so reviewers can skip registration
    from datetime import datetime, timezone

    from app.core.security import hash_password
    from app.models.ledger import GameLedgerEntry
    from app.models.player import PlayerProfile, PlayerState

    demo_user = User(
        username="demo_player",
        password_hash=hash_password("kaduna-demo-2026"),
        status="active",
    )
    db.add(demo_user)
    await db.flush()
    demo_profile = PlayerProfile(
        user_id=demo_user.id, display_name="Demo Player", avatar_id="danfo_rider",
        reputation=0,
    )
    db.add(demo_profile)
    await db.flush()
    db.add(
        PlayerState(
            player_id=demo_profile.id, region_id=region.id,
            position_x=entity_map["spawn_roadside"].position_x,
            position_y=0.0, position_z=entity_map["spawn_roadside"].position_z,
        )
    )
    db.add(
        GameLedgerEntry(
            account_reference=f"player:{demo_profile.id}",
            asset_type="ngn_minor",
            amount_minor_units=25_000_00,
            transaction_reference=f"grant:demo:{int(datetime.now(timezone.utc).timestamp())}",
            entry_type="grant_initial",
            description="Starting simulated NGN (game currency - not Bitcoin)",
        )
    )
    await db.commit()
    return True
