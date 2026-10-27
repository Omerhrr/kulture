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

# district content items (upserted by reconcile_content on every boot)
NEW_ITEMS = [
    ("wax_print", "Wax Print Fabric", "fashion", "Six yards of Dutch wax, the sharp pattern everybody is asking for.", "\U0001f9f5"),
    ("kunu_aya", "Kunu Aya", "food", "Tiger nut and date drink, ice cold. The KASU gate sellers know.", "\U0001f9cb"),
    ("data_bundle", "Data Bundle Card", "electronics", "10GB data card. No be small thing.", "\U0001f4f6"),
    ("tokunbo_sneakers", "Tokunbo Sneakers", "fashion", "UK used, clean, your size dey.", "\U0001f45f"),
    ("tomato_basket", "Basket of Tomatoes", "food", "Fresh from the fadama farms, still bearing the morning dew.", "\U0001f345"),
]

ENTITIES = [
    # code, name, type, raw x, raw z (bake units, scaled by
    # settings.world_scale when written), rotation, radius (meters)
    ("spawn_roadside", "Ahmadu Bello Way - Roadside Spawn", "spawn", -60.667, 85.483, 0.0, 8.0),
    ("musa_shop", "Musa's Provision Store", "shop", -49.333, 80.183, 0.4, 10.0),
    ("arewa_pos", "Arewa QuickPOS Kiosk", "pos_kiosk", -34.667, -2.683, 0.0, 6.0),
    ("kaduna_central_market", "Kaduna Central Market", "market", -70.0, 98.0, -0.5, 14.0),
    ("arewa_house", "Arewa House", "landmark", -34.667, -144.45, 0.9, 10.0),
    ("stonetech_square", "Stonetech Square", "landmark", -42.0, 350.0, -0.4, 10.0),
    ("keke_stop", "Keke Napep Stop, Kaduna Junction", "transport_stop", -240.667, 417.05, 0.2, 8.0),
    ("npc_musa", "Mallam Musa", "npc", -50.5, 82.583, 0.5, 4.0),
    ("npc_amina", "Hajiya Amina", "npc", -43.667, 349.333, -0.3, 4.0),
]

# district content entities (upserted by reconcile_content on every boot).
# Same raw coordinates the frontend mirrors in kaduna.ts PLAYABLE_RAW.
NEW_ENTITIES = [
    ("textile_market", "Kaduna Textile Market", "market", -186.0, 640.0, -0.4, 12.0),
    ("kawo_motor_park", "Kawo Motor Park", "transport_stop", 76.0, -546.0, 0.1, 12.0),
    ("kasu_gate", "KASU Main Gate", "landmark", 112.0, 108.0, 0.0, 10.0),
    ("rigasa_station", "Rigasa Station Freight Office", "transport_stop", -943.0, -134.0, -0.2, 12.0),
    ("sabon_tasha_shop", "Sabon Tasha Community Shop", "shop", 247.667, 1032.0, 0.3, 10.0),
    ("npc_mama_chidi", "Mama Chidi", "npc", -181.0, 631.0, 0.5, 4.0),
    ("npc_bashir", "Bashir the Union Man", "npc", 69.0, -542.0, -0.4, 4.0),
    ("npc_prof_danjuma", "Professor Danjuma", "npc", 109.5, 106.5, 0.2, 4.0),
    ("npc_tunde", "Tunde the Freight Officer", "npc", -936.0, -130.0, 0.3, 4.0),
    ("npc_ngozi", "Ngozi of Sabon Tasha", "npc", 247.0, 1034.067, -0.5, 4.0),
]

SHOP_LISTINGS = [
    # item_code, stock, ksats, sats
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

# ---------------------------------------------------------------- district content
# Businesses, listings, NPC agents and delivery jobs for the five new
# district spots. Upserted by reconcile_content on every boot, so both a
# fresh database and an already-seeded one end up with the same world.
BUSINESS_DEFS = [
    # code, name, business_type, entity_code, tagline
    ("textile_fabrics", "Mama Chidi's Fabric Stall", "shop", "textile_market", "Wax prints, ankara, tokunbo - everything fabric"),
    ("campus_kiosk", "KASU Campus Kiosk", "shop", "kasu_gate", "Snacks and data for the campus crowd"),
    ("station_freight", "Rigasa Freight Office", "shop", "rigasa_station", "Waybills, parcels and departure times"),
    ("sabon_tasha_stores", "Sabon Tasha Community Shop", "shop", "sabon_tasha_shop", "The southern shops everybody knows"),
]

# business_code -> [(item_code, stock, ksats, sats)]
LISTING_DEFS: dict[str, list[tuple[str, int, int, int]]] = {
    "textile_fabrics": [
        ("wax_print", 18, 815_000, 3500),
        ("tokunbo_sneakers", 10, 650_000, 2800),
        ("ankara_fabric", 12, 1_050_000, 4500),
        ("data_bundle", 25, 720_000, 3100),
    ],
    "campus_kiosk": [
        ("kunu_aya", 30, 140_000, 600),
        ("kuli_kuli", 40, 160_000, 650),
        ("suya_spice", 24, 300_000, 1300),
        ("data_bundle", 20, 700_000, 3000),
    ],
    "station_freight": [
        ("suya_spice", 20, 290_000, 1250),
        ("fura_nono", 16, 440_000, 1900),
        ("zobo_concentrate", 26, 245_000, 1050),
        ("data_bundle", 22, 680_000, 2900),
    ],
    "sabon_tasha_stores": [
        ("tomato_basket", 22, 210_000, 900),
        ("kunu_aya", 26, 150_000, 650),
        ("kuli_kuli", 34, 165_000, 700),
        ("fura_nono", 14, 420_000, 1800),
    ],
}

NPC_DEFS = [
    # code, name, entity_code, business_code or None, agent_type, persona
    ("kaduna_fabric_trader_001", "Mama Chidi", "npc_mama_chidi", "textile_fabrics", "shopkeeper",
     "Mama Chidi runs the fabric stall at the Kaduna Textile Market by the old "
     "Textile Mill. A sharp Igbo trader with a warm laugh: she knows every wax "
     "print by name, gives honest prices, and never lets a customer leave "
     "unhappy. She knows Bitcoin Lightning lets customers pay with real sats, "
     "but she cannot touch anyone's wallet - the payment system settles."),
    ("kaduna_union_driver_001", "Bashir", "npc_bashir", None, "recipient",
     "Bashir is the NURTW union man at Kawo Motor Park. Loud voice, warm "
     "heart, pocket full of small change. He knows every route, fare and "
     "shortcut in Kaduna, and will tell you which keke to take and which "
     "driver to avoid. Mixes Hausa greetings into his Nigerian English."),
    ("kaduna_professor_001", "Professor Danjuma", "npc_prof_danjuma", "campus_kiosk", "shopkeeper",
     "Professor Danjuma teaches economics at Kaduna State University and runs "
     "a small kiosk at the main gate for students. Measured, thoughtful, "
     "loves a good debate about scarcity, incentives and sats. He explains "
     "Lightning payments to students with real examples, but he cannot touch "
     "anyone's wallet - the payment system settles."),
    ("kaduna_freight_officer_001", "Tunde", "npc_tunde", "station_freight", "shopkeeper",
     "Tunde is the freight officer at Rigasa Station. Precise, "
     "timetable-obsessed, scans every package twice. He talks in departure "
     "times and waybill numbers, but softens for regular customers. He knows "
     "the station pays delivery jobs through the Lightning ledger."),
    ("kaduna_community_shop_001", "Ngozi", "npc_ngozi", "sabon_tasha_stores", "shopkeeper",
     "Ngozi runs the community shop in Sabon Tasha. Everyone's elder sister: "
     "she sells on credit to regulars, remembers every birthday on the "
     "street, and her tomato baskets are the freshest south of the river. "
     "She settles her stock money through the Lightning ledger."),
]

JOB_DEFS = [
    # code, title, description, issuer_business_code, pickup_code, dropoff_code, ksats, rep
    ("deliv-musa-kasu-0002", "Deliver textbooks to KASU Main Gate",
     "Collect a parcel at Musa's Provision Store and take it to Professor "
     "Danjuma at the KASU Main Gate, east across town.",
     "musa_provision_store", "musa_shop", "kasu_gate", 6_000_00, 5),
    ("deliv-musa-kawo-0003", "Parcel run to Kawo Motor Park",
     "Musa has a parcel bound for the north. Take it to Bashir at the Kawo "
     "Motor Park union point.",
     "musa_provision_store", "musa_shop", "kawo_motor_park", 7_500_00, 5),
    ("deliv-textile-musa-0004", "Wax print bolts to Musa's store",
     "Mama Chidi set aside six bolts of wax print for Musa. Pick them up at "
     "the Textile Market and deliver them to his shop.",
     "textile_fabrics", "textile_market", "musa_shop", 9_000_00, 6),
    ("deliv-textile-rigasa-0005", "Fabric freight to Rigasa Station",
     "A long-haul load: fabric from the Textile Market must reach Tunde at "
     "the Rigasa Station freight office before the evening train. Best with "
     "a car.",
     "textile_fabrics", "textile_market", "rigasa_station", 16_000_00, 9),
    ("deliv-sabon-market-0006", "Fresh tomatoes to the Central Market",
     "Ngozi's tomato basket must reach the Central Market traders while the "
     "dew is still on it. Ride fast, ride safe.",
     "sabon_tasha_stores", "sabon_tasha_shop", "kaduna_central_market", 11_000_00, 7),
    ("deliv-rigasa-kawo-0007", "Station waybill to Kawo Motor Park",
     "A waybill came in on the morning train. Tunde needs it at the Kawo "
     "Motor Park union point, north-east across town.",
     "station_freight", "rigasa_station", "kawo_motor_park", 12_000_00, 7),
    ("deliv-kasu-stonetech-0008", "Lab supplies to Stonetech Square",
     "Professor Danjuma has a box of lab supplies for Hajiya Amina at "
     "Stonetech Square by the stadium.",
     "campus_kiosk", "kasu_gate", "stonetech_square", 9_500_00, 6),
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
    moved_core = changed
    # district spots (and their keepers) are only nudged to stay off the
    # streets: move the rows, players stay where they are
    for code, _name, _etype, x, z, _rot, _radius in NEW_ENTITIES:
        e = (await db.execute(select(WorldEntity).where(WorldEntity.code == code))).scalar_one_or_none()
        if e is None:
            continue
        tx, tz = x * k, z * k
        if abs(e.position_x - tx) > 0.01 or abs(e.position_z - tz) > 0.01:
            e.position_x, e.position_z = tx, tz
            changed += 1
    if moved_core and spawn is not None:
        # entities moved => old saved player positions belong to the old
        # scale; put everyone back on Ahmadu Bello Way
        for ps in (await db.execute(select(PlayerState))).scalars().all():
            ps.position_x, ps.position_y, ps.position_z = spawn[0], 0.0, spawn[1]
            changed += 1
    if changed:
        await db.commit()
    return changed


async def reconcile_content(db: AsyncSession) -> int:
    """Idempotently add the district content (entities, items, businesses,
    listings, NPC agents, delivery jobs) on every boot. Rows are detected
    by code and skipped, so this is safe for fresh databases (seed_if_empty
    just ran) and for older databases alike. Returns the rows added."""
    added = 0
    region = (
        await db.execute(select(WorldRegion).where(WorldRegion.slug == "kaduna-city"))
    ).scalar_one_or_none()
    if region is None:
        return 0
    k = settings.world_scale

    # 1) entities
    entities = {
        e.code: e
        for e in (await db.execute(select(WorldEntity).where(WorldEntity.region_id == region.id))).scalars()
    }
    for code, name, etype, x, z, rot, radius in NEW_ENTITIES:
        if code in entities:
            continue
        e = WorldEntity(
            region_id=region.id, code=code, name=name, entity_type=etype,
            position_x=x * k, position_y=0.0, position_z=z * k, rotation=rot,
            interaction_radius=radius, metadata_json={},
        )
        db.add(e)
        entities[code] = e
        added += 1
    await db.flush()

    # 2) items
    items = {i.code: i for i in (await db.execute(select(Item))).scalars()}
    for code, name, itype, desc, emoji in NEW_ITEMS:
        if code in items:
            continue
        it = Item(code=code, name=name, item_type=itype, description=desc, emoji=emoji)
        db.add(it)
        items[code] = it
        added += 1
    await db.flush()

    # 3) businesses (they hang off entities; original rows keep their ids)
    biz_codes = [b[0] for b in BUSINESS_DEFS]
    businesses = {
        b.code: b
        for b in (
            await db.execute(select(Business).where(Business.code.in_(biz_codes)))
        ).unique().scalars()
    }
    for code, name, btype, entity_code, tagline in BUSINESS_DEFS:
        if code in businesses:
            continue
        b = Business(
            code=code, name=name, owner_type="npc", owner_id=None, business_type=btype,
            entity_id=entities[entity_code].id, status="open",
            metadata_json={"tagline": tagline},
        )
        db.add(b)
        businesses[code] = b
        added += 1
    await db.flush()

    # 4) listings: only for businesses that have none (never touch a
    # shopkeeper's live prices)
    for bcode, rows in LISTING_DEFS.items():
        biz = businesses.get(bcode)
        if biz is None:
            continue
        have = (
            await db.execute(select(func.count()).select_from(ShopListing).where(ShopListing.business_id == biz.id))
        ).scalar_one()
        if have > 0:
            continue
        for item_code, stock, ksats, sats in rows:
            item = items.get(item_code)
            if item is None:
                continue
            db.add(
                ShopListing(
                    business_id=biz.id, item_id=item.id, quantity_available=stock,
                    price_ksats=ksats, price_sats=sats, is_active=True,
                )
            )
            added += 1

    # 5) NPC agents
    agents = {
        a.code: a
        for a in (await db.execute(select(NPCAgent).where(NPCAgent.code.in_([n[0] for n in NPC_DEFS])))).scalars()
    }
    for code, name, entity_code, biz_code, agent_type, persona in NPC_DEFS:
        if code in agents:
            continue
        db.add(
            NPCAgent(
                code=code, name=name, persona=persona,
                world_entity_id=entities[entity_code].id,
                business_id=businesses[biz_code].id if biz_code else None,
                agent_type=agent_type,
                allowed_tools=SHOPKEEPER_TOOLS if biz_code else [],
                configuration={"interaction_log": []}, status="active",
            )
        )
        added += 1

    # 6) jobs - the district board is a fixture: when every instance of a
    # route is taken (assigned / in progress / completed), mint ONE fresh
    # instance so the board restocks on the next boot instead of draining
    # forever. Instances carry a numbered suffix on the base code.
    job_codes = [j[0] for j in JOB_DEFS]
    jobs = {
        j.code: j
        for j in (await db.execute(select(Job).where(Job.code.in_(job_codes)))).scalars()
    }
    for code, title, desc, issuer_code, pickup_code, dropoff_code, ksats, rep in JOB_DEFS:
        if code not in jobs:
            db.add(
                Job(
                    code=code, job_type="delivery", title=title, description=desc,
                    issuer_business_id=businesses[issuer_code].id if issuer_code in businesses else None,
                    status="available",
                    pickup_entity_id=entities[pickup_code].id,
                    dropoff_entity_id=entities[dropoff_code].id,
                    reward_ksats=ksats, reward_reputation=rep,
                )
            )
            added += 1
            continue
        if jobs[code].status == "available":
            continue
        prior = (
            (await db.execute(select(Job).where(Job.code.like(f"{code}-%")))).scalars().all()
        )
        if any(j.status == "available" for j in prior):
            continue
        n = len(prior) + 1
        db.add(
            Job(
                code=f"{code}-{n:04d}", job_type="delivery", title=title, description=desc,
                issuer_business_id=businesses[issuer_code].id if issuer_code in businesses else None,
                status="available",
                pickup_entity_id=entities[pickup_code].id,
                dropoff_entity_id=entities[dropoff_code].id,
                reward_ksats=ksats, reward_reputation=rep,
            )
        )
        added += 1

    if added:
        await db.commit()
    return added


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

    for item_code, stock, ksats, sats in SHOP_LISTINGS:
        db.add(
            ShopListing(
                business_id=biz_musa.id, item_id=items[item_code].id,
                quantity_available=stock, price_ksats=ksats,
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
            reward_ksats=8_000_00, reward_reputation=5,
        )
    )

    await db.commit()
    return True


async def refresh_seed_text(db: AsyncSession) -> int:
    """Keep seeded names and job texts in step with this file on databases
    created by an older build (wrong district names, wrong directions).
    Only rows still carrying a seeded code are touched. Idempotent."""
    n = 0
    names = {code: name for code, name, *_ in [*ENTITIES, *NEW_ENTITIES]}
    for e in (await db.execute(select(WorldEntity).where(WorldEntity.code.in_(list(names))))).scalars():
        if e.name != names[e.code]:
            e.name = names[e.code]
            n += 1
    texts = {code: (title, desc) for code, title, desc, *_ in JOB_DEFS}
    texts["deliv-musa-stonetech-0001"] = (
        "Deliver Suya Spice to Stonetech Square",
        "Collect a sealed package from Musa's Provision Store and deliver it to "
        "Hajiya Amina at Stonetech Square.",
    )
    for j in (await db.execute(select(Job).where(Job.code.in_(list(texts))))).scalars():
        title, desc = texts[j.code]
        if (j.title, j.description) != (title, desc):
            j.title, j.description = title, desc
            n += 1
    if n:
        await db.commit()
    return n


DEMO_USERNAME = "demo_player"


async def retire_demo_account(db: AsyncSession) -> bool:
    """Lock the old shared demo account on databases seeded before sign-up
    became the only way in. Kept (not deleted) so rows that point at it stay
    valid; its password is replaced so it can never log in again."""
    import secrets

    from app.core.security import hash_password

    user = (await db.execute(select(User).where(User.username == DEMO_USERNAME))).scalar_one_or_none()
    if user is None or user.status == "disabled":
        return False
    user.status = "disabled"
    user.password_hash = hash_password(secrets.token_urlsafe(32))
    await db.commit()
    return True
