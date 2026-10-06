#!/usr/bin/env python3
"""Build compact, offline SVG geometry from public-domain Natural Earth data.

Run with --source-dir pointing at cached ne_*.geojson files, or allow this script
to download pinned source files. All runtime geometry lives in world.json;
there are no map services or dependencies in the browser.
"""
import argparse
import collections
import gzip
import hashlib
import json
import math
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_REF = 'ca96624a56bd078437bca8184e78163e5039ad19'
SOURCE_ROOT = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/' + SOURCE_REF + '/geojson/'
INPUTS = {
    'units': 'ne_10m_admin_0_map_units.geojson',
    'admin1': 'ne_10m_admin_1_states_provinces.geojson',
    'disputed': 'ne_10m_admin_0_disputed_areas.geojson',
}

# Stable ISO-style identifiers replace Natural Earth's special map-unit codes.
COUNTRY_RENAMES = {
    'FXX': ('fra', 'France'), 'ENG': ('gbr', 'United Kingdom'),
    'BFR': ('bel', 'Belgium'), 'BHF': ('bih', 'Bosnia and Herzegovina'),
    'GEG': ('geo', 'Georgia'), 'SRS': ('srb', 'Serbia'),
    'IRR': ('irq', 'Iraq'), 'SOX': ('som', 'Somalia'),
    'PNX': ('png', 'Papua New Guinea'), 'ACA': ('atg', 'Antigua and Barbuda'),
    'PRX': ('prt', 'Portugal'), 'NLX': ('nld', 'Netherlands'),
    'GAZ': ('pse', 'Palestine'), 'SYX': ('syr', 'Syria'),
    'SDS': ('ssd', 'South Sudan'), 'NOW': ('nor', 'Norway'),
    'KOS': ('xkx', 'Kosovo'), 'ALD': ('ala', 'Åland Islands'),
}
MERGE_TO = {'WEB': 'pse', 'SYU': 'syr', 'KNX': 'kor', 'KNZ': 'prk', 'KAB': 'kaz', 'USG': 'cub', 'CNM': 'cyp'}
INTERNAL_UNITS = {
    'SCT': ('gbr', 'Scotland'), 'WLS': ('gbr', 'Wales'), 'NIR': ('gbr', 'Northern Ireland'),
    'BWR': ('bel', 'Wallonia'), 'BCR': ('bel', 'Brussels-Capital Region'),
    'BIS': ('bih', 'Republika Srpska'), 'BHB': ('bih', 'Brčko District'),
    'GEA': ('geo', 'Adjara'), 'SRV': ('srb', 'Vojvodina'),
    'IRK': ('irq', 'Kurdistan Region'), 'SOP': ('som', 'Puntland'),
    'PNB': ('png', 'Bougainville'), 'ACB': ('atg', 'Barbuda'),
    'TZZ': ('tza', 'Zanzibar'), 'PMD': ('prt', 'Madeira'), 'PAZ': ('prt', 'Azores'),
    'ALD': ('fin', 'Åland Islands'),
}
COUNTRY_REGION_SPLITS = {'BFR': ('bel-flanders', 'Flanders'), 'BHF': ('bih-federation', 'Federation of Bosnia and Herzegovina')}
UNPLAYABLE = {'ATA','ATF','HMD','BVT','SGS','NJM','CSI','ATC','PFA','PGA','CLP','JQI','DQI','FQI','HQI','WQI','MQI','BQI','LQI','KQI','BJN','SER','SCR','BRI','KAS','SPI','BRT','ESB','WSB'}
DISPUTED_UNITS = {'SOL', 'CYN', 'SAH'}
DISPLAY_NAMES = {
    'CHN': 'China', 'USA': 'United States', 'GBR': 'United Kingdom', 'KOR': 'South Korea',
    'PRK': 'North Korea', 'RUS': 'Russia', 'CZE': 'Czechia', 'LAO': 'Laos', 'TWN': 'Taiwan',
    'SWZ': 'Eswatini', 'TLS': 'Timor-Leste', 'BRN': 'Brunei', 'CPV': 'Cabo Verde',
    'VAT': 'Vatican City', 'CIV': "Côte d’Ivoire", 'BHS': 'Bahamas', 'FRO': 'Faroe Islands',
    'CCK': 'Cocos (Keeling) Islands', 'MAC': 'Macau', 'WLF': 'Wallis and Futuna',
    'NSV': 'Svalbard', 'NJM': 'Jan Mayen', 'BLM': 'Saint Barthélemy',
    'MAF': 'Saint Martin', 'FLK': 'Falkland Islands', 'STP': 'São Tomé and Príncipe',
}
ALIASES = {
    'usa': ['USA','US','United States of America','America'],
    'gbr': ['UK','United Kingdom of Great Britain and Northern Ireland','Britain','Great Britain'],
    'cze': ['Czech Republic'], 'civ': ['Ivory Coast','Cote d Ivoire','Cote dIvoire'],
    'cod': ['DR Congo','DRC','Congo Kinshasa','Democratic Republic of Congo'],
    'cog': ['Congo Republic','Congo Brazzaville','Republic of Congo'],
    'swz': ['Swaziland','eSwatini'], 'cpv': ['Cape Verde'], 'tls': ['East Timor'],
    'mmr': ['Burma'], 'pse': ['State of Palestine','Palestinian Territories','Palestinian territories'],
    'vat': ['Vatican','Holy See'], 'kor': ['Republic of Korea'], 'prk': ['DPRK'],
    'tza': ['United Republic of Tanzania'], 'mkd': ['Macedonia'],
    'mac': ['Macao'], 'ala': ['Aland','Aland Islands','Åland'], 'fro': ['Faeroe Islands'],
    'fsm': ['Micronesia','FSM'], 'bhs': ['The Bahamas'], 'gmb': ['Gambia'],
    'are': ['UAE'], 'nzl': ['NZ'], 'sau': ['KSA'], 'caf': ['CAR'],
    'vgb': ['BVI'], 'vir': ['USVI','U.S. Virgin Islands','US Virgin Islands'],
    'hkg': ['Hong Kong SAR','Hong Kong S.A.R.'], 'mac': ['Macao','Macau SAR','Macao SAR'],
    'irk': ['Kurdistan','Iraqi Kurdistan'], 'bih': ['Bosnia'],
    'sxm': ['St Maarten','Saint Maarten'],
    'cn-xz': ['Tibet','Tibet Autonomous Region','Xizang'],
    'cn-nm': ['Inner Mongolia','Inner Mongol'], 'ru-yev': ['Jewish Autonomous Oblast','Yevrey'],
    'ru-sa': ['Sakha','Yakutia'], 'ru-khm': ['Khanty Mansi','Khanty-Mansi Autonomous Okrug','Yugra'],
}

SPAIN_REGIONS = {
    'Andalucía': ('es-an', 'Andalusia'), 'Aragón': ('es-ar', 'Aragon'),
    'Asturias': ('es-as', 'Asturias'), 'Islas Baleares': ('es-ib', 'Balearic Islands'),
    'Canary Is.': ('es-cn', 'Canary Islands'), 'Cantabria': ('es-cb', 'Cantabria'),
    'Castilla-La Mancha': ('es-cm', 'Castilla-La Mancha'), 'Castilla y León': ('es-cl', 'Castile and León'),
    'Cataluña': ('es-ct', 'Catalonia'), 'Extremadura': ('es-ex', 'Extremadura'),
    'Galicia': ('es-ga', 'Galicia'), 'Madrid': ('es-md', 'Community of Madrid'),
    'Murcia': ('es-mc', 'Region of Murcia'), 'Foral de Navarra': ('es-nc', 'Navarre'),
    'País Vasco': ('es-pv', 'Basque Country'), 'La Rioja': ('es-ri', 'La Rioja'),
    'Valenciana': ('es-vc', 'Valencian Community'), 'Ceuta': ('es-ce', 'Ceuta'), 'Melilla': ('es-ml', 'Melilla'),
}
ITALY_REGIONS = {
    "Valle d'Aosta": ('it-23', 'Aosta Valley'), 'Sardegna': ('it-88', 'Sardinia'),
    'Sicily': ('it-82', 'Sicily'), 'Friuli-Venezia Giulia': ('it-36', 'Friuli Venezia Giulia'),
    'Trentino-Alto Adige': ('it-32', 'Trentino-Alto Adige/Südtirol'),
}
SELECTED_ISO = {
    'UZ-QR': 'Karakalpakstan', 'TJ-GB': 'Gorno-Badakhshan', 'MD-GA': 'Gagauzia',
    'MY-12': 'Sabah', 'MY-13': 'Sarawak', 'GR-69': 'Mount Athos', 'MU-RO': 'Rodrigues',
    'ST-P': 'Príncipe', 'PK-JK': 'Azad Kashmir', 'PK-GB': 'Gilgit-Baltistan',
    'CA-YT': 'Yukon', 'CA-NT': 'Northwest Territories', 'CA-NU': 'Nunavut',
    'AU-NT': 'Northern Territory', 'AU-ACT': 'Australian Capital Territory',
    'NI-AN': 'North Caribbean Coast Autonomous Region', 'NI-AS': 'South Caribbean Coast Autonomous Region',
    'PA-KY': 'Guna Yala', 'PA-EM': 'Emberá-Wounaan', 'PA-NB': 'Ngäbe-Buglé',
    'ID-AC': 'Aceh', 'ID-YO': 'Yogyakarta',
}
RUS_NAMES = {'RU-AL': 'Altai Republic', 'RU-AD': 'Adygea', 'RU-BU': 'Buryatia',
 'RU-KC': 'Karachay-Cherkessia', 'RU-KB': 'Kabardino-Balkaria', 'RU-SE': 'North Ossetia-Alania',
 'RU-IN': 'Ingushetia', 'RU-KR': 'Karelia', 'RU-KL': 'Kalmykia', 'RU-KK': 'Khakassia',
 'RU-CU': 'Chuvashia', 'RU-ME': 'Mari El', 'RU-UD': 'Udmurtia', 'RU-YEV': 'Jewish Autonomous Oblast',
 'RU-CHU': 'Chukotka Autonomous Okrug', 'RU-YAN': 'Yamalo-Nenets Autonomous Okrug',
 'RU-NEN': 'Nenets Autonomous Okrug', 'RU-SA': 'Sakha (Yakutia)', 'RU-KHM': 'Khanty-Mansi Autonomous Okrug'}

def polygons(geometry):
    return [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']

def quantize(ring):
    points = [(round((x + 180) * 10000), round((90 - y) * 10000)) for x, y, *_ in ring]
    result = [p for i, p in enumerate(points) if i == 0 or p != points[i - 1]]
    if result and result[-1] == result[0]: result.pop()
    return result if len(result) >= 3 else []

def feature_rings(feature):
    return [q for poly in polygons(feature['geometry']) for ring in poly if (q := quantize(ring))]

def dissolve(rings):
    """Cancel exact opposite shared edges; stitch remaining boundaries as rings."""
    edges = collections.Counter()
    for ring in rings:
        for i, point in enumerate(ring):
            edge = (point, ring[(i + 1) % len(ring)])
            reverse = edge[::-1]
            if edges[reverse]:
                edges[reverse] -= 1
                if not edges[reverse]: del edges[reverse]
            else: edges[edge] += 1
    next_points = collections.defaultdict(list)
    for (a, b), count in edges.items(): next_points[a].extend([b] * count)
    result = []
    while next_points:
        start = next(iter(next_points))
        ring = [start]
        point = start
        while True:
            choices = next_points.get(point)
            if not choices: raise ValueError('Unclosed dissolved boundary')
            other = choices.pop()
            if not choices: del next_points[point]
            if other == start: break
            ring.append(other)
            point = other
        if len(ring) >= 3: result.append(ring)
    return result

def area(ring):
    return sum(p[0] * ring[(i+1) % len(ring)][1] - ring[(i+1) % len(ring)][0] * p[1] for i,p in enumerate(ring)) / 2

def rdp(points, epsilon=12.5):
    if len(points) <= 2: return points
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]; bx, by = points[b]
        dx, dy = bx-ax, by-ay
        length = dx*dx + dy*dy
        max_dist, max_i = -1, a
        for i in range(a+1,b):
            px, py = points[i]
            t = max(0,min(1,((px-ax)*dx+(py-ay)*dy)/length)) if length else 0
            dist = (px-ax-t*dx)**2 + (py-ay-t*dy)**2
            if dist > max_dist: max_dist,max_i = dist,i
        if max_dist > epsilon*epsilon:
            keep.add(max_i); stack.extend([(a,max_i),(max_i,b)])
    return [points[i] for i in sorted(keep)]

def simplify_rings(all_rings,epsilon=12.5):
    """Shared chains get one canonical simplification. Tiny islands retain detail."""
    neighbors = collections.defaultdict(set)
    for rings in all_rings:
        for ring in rings:
            for i,p in enumerate(ring):
                neighbors[p].update((ring[i-1],ring[(i+1)%len(ring)]))
    cache = {}
    output = []
    for rings in all_rings:
        revised = []
        for ring in rings:
            if abs(area(ring)) < 50000 or len(ring) < 15:
                revised.append(ring); continue
            junctions = [i for i,p in enumerate(ring) if len(neighbors[p]) != 2]
            if len(junctions) < 2:
                start = junctions[0] if junctions else min(range(len(ring)),key=lambda i:ring[i])
                ring = ring[start:] + ring[:start]
                reverse=[ring[0]]+ring[:0:-1]
                flipped=tuple(reverse)<tuple(ring)
                if flipped:ring=reverse
                opposite = max(range(1,len(ring)),key=lambda i:(ring[i][0]-ring[0][0])**2+(ring[i][1]-ring[0][1])**2)
                result = rdp(ring[:opposite+1],epsilon)[:-1] + rdp(ring[opposite:]+[ring[0]],epsilon)[:-1]
                if flipped:
                    result=[result[0]]+result[:0:-1]
                    ring=[ring[0]]+ring[:0:-1]
            else:
                result = []
                for n,start in enumerate(junctions):
                    end = junctions[(n+1)%len(junctions)]
                    chain = ring[start:end+1] if end > start else ring[start:]+ring[:end+1]
                    forward = tuple(chain)
                    reverse = forward[::-1]
                    key = min(forward,reverse)
                    if key not in cache: cache[key] = rdp(list(key),epsilon)
                    result.extend((cache[key] if key == forward else cache[key][::-1])[:-1])
            revised.append(result if len(result) >= 3 and area(result)*area(ring)>0 else ring)
        output.append(revised)
    return output

def number(value):
    result=('%.3f' % (value/1000)).rstrip('0').rstrip('.')
    return result.replace('0.','.').replace('-0.','-.') if result.startswith(('0.','-0.')) else result

def svg_path(rings):
    parts = []
    for ring in rings:
        x,y=ring[0]
        parts.append('M'+number(x)+','+number(y)+'l')
        for xx,yy in ring[1:]:
            parts.append(number(xx-x)+','+number(yy-y)+' ')
            x,y=xx,yy
        parts.append('z')
    return ''.join(parts).replace(' z','z')

def bounds(rings):
    points=[p for ring in rings for p in ring]
    if not points: return [0,0,0,0]
    return [min(p[0] for p in points)/1000,min(p[1] for p in points)/1000,max(p[0] for p in points)/1000,max(p[1] for p in points)/1000]

def geometry_center(rings):
    if not rings: return [1800,900]
    ring=max(rings,key=lambda r:abs(area(r)))
    signed=area(ring)
    if signed:
        cx=cy=0
        for i,(x,y) in enumerate(ring):
            nx,ny=ring[(i+1)%len(ring)]; cross=x*ny-nx*y
            cx+=(x+nx)*cross; cy+=(y+ny)*cross
        return [round(cx/(6*signed)/1000,3),round(cy/(6*signed)/1000,3)]
    b=bounds([ring]);return [(b[0]+b[2])/2,(b[1]+b[3])/2]

def region_match(p):
    country=p['adm0_a3']; code=p['iso_3166_2']
    if country=='ESP':
        region=p['region']
        if region not in SPAIN_REGIONS: raise ValueError('Unmapped Spanish region '+str(region))
        return SPAIN_REGIONS[region]
    if country=='ITA' and p['region'] in ITALY_REGIONS: return ITALY_REGIONS[p['region']]
    if country=='CHN' and p['type_en']=='Autonomous Region':
        return code.lower(), {'CN-NM':'Inner Mongolia','CN-XZ':'Tibet','CN-XJ':'Xinjiang','CN-GX':'Guangxi','CN-NX':'Ningxia'}[code]
    if country=='RUS' and (p['type_en'] in {'Republic','Autonomous Region','Autonomous Province'}):
        return code.lower(),RUS_NAMES.get(code,p['name_en'] or p['name'])
    if country=='RUS' and code=='UA-43': return 'ua-crimea','Crimea'
    if country=='AZE' and p['region']=='Naxçıvan Autonomous Republic': return 'az-nx','Nakhchivan'
    if country=='MDA' and (code=='MD-SN' or p['name'] in {'Camenca','Grigoriopol','Bender'}): return 'md-transnistria','Transnistria'
    if country=='IDN' and code in {'ID-PA','ID-PB'}: return 'id-papua','Papua special-autonomy area'
    if country=='PHL' and (p['region']=='Autonomous Region in Muslim Mindanao (ARMM)' and p['name']!='Sulu'):
        return 'ph-bangsamoro','Bangsamoro'
    if country=='FRA' and p['region']=='Corse': return 'fr-corsica','Corsica'
    if code in SELECTED_ISO: return code.lower(),SELECTED_ISO[code]
    return None

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir',type=pathlib.Path,default=ROOT/'scripts'/'source-cache')
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'public'/'data'/'world.json')
    args=parser.parse_args(); args.source_dir.mkdir(parents=True,exist_ok=True)
    datasets={}; source_hashes={}
    for key,filename in INPUTS.items():
        path=args.source_dir/filename
        if not path.exists():
            print('Downloading',filename)
            path.write_bytes(urllib.request.urlopen(SOURCE_ROOT+filename).read())
        raw=path.read_bytes(); source_hashes[filename]=hashlib.sha256(raw).hexdigest()
        datasets[key]=json.loads(raw)['features']

    entities={}; shapes={}; source_props={}
    def add(identifier,name,kind,rings,props=None,parent=None,subtype=None,playable=True,units=None):
        if identifier in entities:
            shapes[identifier].extend(rings)
            entities[identifier]['sourceUnits'].extend(units or [])
            return
        p=props or {}
        entity={'id':identifier,'name':name,'kind':kind,'aliases':ALIASES.get(identifier,[]).copy(),'playable':playable,
          'continent':p.get('CONTINENT') or p.get('continent') or '','sovereign':p.get('SOVEREIGNT') or '',
          'iso2':p.get('ISO_A2_EH') if p.get('ISO_A2_EH') not in {'-99',None} else p.get('ISO_A2',''),
          'sourceUnits':units or []}
        if parent: entity['parentId']=parent
        if subtype: entity['subtype']=subtype
        entities[identifier]=entity;shapes[identifier]=rings;source_props[identifier]=p

    for f in datasets['units']:
        p=f['properties']; code=p['GU_A3']; rings=feature_rings(f)
        if code in MERGE_TO:
            continue
        identifier,name=COUNTRY_RENAMES.get(code,(code.lower(),DISPLAY_NAMES.get(code,p['NAME_EN'] or p['NAME_LONG'] or p['NAME'])))
        if code in INTERNAL_UNITS:
            parent,name=INTERNAL_UNITS[code]
            add(identifier,name,'territory',rings,p,parent,'Autonomous region',units=[code]);continue
        is_country=p['TYPE'] in {'Sovereign country','Sovereignty'} or code in COUNTRY_RENAMES and code!='ALD' or code in {'CHN','ISR','FIN','DNK','AUS','NZL','USA','TWN','NOR','NOW','CUB','KAZ'}
        if code in DISPUTED_UNITS: is_country=False
        kind='country' if is_country else 'territory'
        subtype='Disputed territory' if code in DISPUTED_UNITS else ('Dependency or special territory' if kind=='territory' else None)
        add(identifier,name,kind,rings,p,subtype=subtype,playable=code not in UNPLAYABLE,units=[code])
        if code in COUNTRY_REGION_SPLITS:
            child,name=COUNTRY_REGION_SPLITS[code]
            add(child,name,'territory',rings.copy(),p,identifier,'Federated region',units=[code])
            shapes[identifier]=[]
    # Attach base-zone, demilitarized-zone, lease and Palestine split pieces.
    for f in datasets['units']:
        code=f['properties']['GU_A3']
        if code in MERGE_TO: shapes[MERGE_TO[code]].extend(feature_rings(f));entities[MERGE_TO[code]]['sourceUnits'].append(code)

    # Capture full parent extents before replacing detailed subdivision geometry.
    full_shapes={k:list(v) for k,v in shapes.items()}
    for identifier,entity in entities.items():
        if parent:=entity.get('parentId'): full_shapes[parent].extend(shapes[identifier])

    grouped=collections.defaultdict(list)
    for f in datasets['admin1']:
        p=f['properties']
        if match:=region_match(p): grouped[(p['adm0_a3'].lower(),match[0],match[1])].append(f)
    # Use all remaining admin1 polygons for split countries: exact shared edges,
    # and country geometry never covers its separately playable child region.
    replacing={parent for parent,_,_ in grouped}
    for parent in replacing:
        if parent not in entities: raise ValueError('Missing parent '+parent)
        shapes[parent]=[]
    for f in datasets['admin1']:
        p=f['properties'];parent=p['adm0_a3'].lower()
        if parent not in replacing:continue
        if region_match(p):continue
        if parent=='fra' and p['type_en']=='Overseas department':continue
        shapes[parent].extend(feature_rings(f))
    for (parent,identifier,name),features in grouped.items():
        rings=[r for f in features for r in feature_rings(f)]
        props=source_props[parent]
        add(identifier,name,'territory',rings,props,parent,'Autonomous region',units=[f['properties']['iso_3166_2'] for f in features])
        entities[identifier]['aliases'].extend(sorted({f['properties']['name'] for f in features if f['properties']['name'] and len(features)==1}))
        full_shapes[identifier]=rings

    # User requested the two breakaway entities explicitly. Reverse source
    # rings carve them out of Georgia under the SVG nonzero winding rule.
    for f in datasets['disputed']:
        p=f['properties'];name=p['BRK_NAME']
        if name not in {'Abkhazia','South Ossetia'}:continue
        identifier={'Abkhazia':'abkhazia','South Ossetia':'south-ossetia'}[name]
        rings=feature_rings(f)
        add(identifier,name,'territory',rings,p,subtype='Disputed territory',units=[p['GU_A3']])
        entities[identifier]['sovereign']='Disputed'
        entities[identifier]['statusNote']='Self-administered; claimed by Georgia. Display does not imply recognition.'
        shapes['geo'].extend([list(reversed(r)) for r in rings])
        full_shapes[identifier]=rings

    # Notes are intentionally attached to the affected entities and inventory.
    notes={
      'ph-bangsamoro':'Approximate footprint from older ARMM province boundaries, with Sulu excluded. Current Special Geographic Area and the Isabela City exclusion are not resolved at this source scale.',
      'id-papua':'Combined special-autonomy area of western New Guinea. Source predates the 2022 division into six provinces; those six are represented together.',
      'ua-crimea':'Disputed autonomous republic. Natural Earth displays de facto administration; international recognition is not implied.',
      'md-transnistria':'Self-administered disputed territory; claimed by Moldova. Source geometry is generalized.',
      'iot':'Natural Earth 5.1.1 name and administration snapshot; the Chagos sovereignty agreement may change current legal status.',
    }
    for identifier,note in notes.items():
        if identifier in entities:entities[identifier]['statusNote']=note

    # Alderney and Sark have their own elected legislatures. Split their NE
    # subunit polygons from the Guernsey map unit; Herm remains with Guernsey.
    supplemental=json.loads((ROOT/'scripts'/'map-supplements.geojson').read_text())
    for f in supplemental['features']:
        p=f['properties'];rings=feature_rings(f)
        island_props={k:v for k,v in source_props['ggy'].items() if k not in {'LABEL_X','LABEL_Y'}}
        add(p['id'],p['name'],'territory',rings,island_props,subtype='Self-governing Crown jurisdiction',units=[p['sourceUnit']])
        shapes['ggy'].extend([list(reversed(r)) for r in rings])
        full_shapes[p['id']]=rings
    full_shapes['ggy']=dissolve(shapes['ggy'])

    # Current NE's Vatican polygon is a tiny cartographic stand-in. Replace it
    # with the publicly published geographic outline and replace Italy's hole.
    # Coordinates are geographic facts; source and the edit are documented.
    vatican_outline=[[12.458324,41.902596],[12.458346,41.901542],[12.457509,41.901015],
      [12.454569,41.900329],[12.450857,41.900616],[12.448754,41.900888],
      [12.447767,41.900856],[12.445815,41.901942],[12.447853,41.903315],
      [12.448926,41.904289],[12.450042,41.905647],[12.451437,41.906733],
      [12.455385,41.907324],[12.455728,41.906349],[12.457638,41.90579],
      [12.457595,41.903363],[12.458324,41.902596]]
    correct_vatican=quantize(vatican_outline)
    old_vatican_center=geometry_center(shapes['vat'])
    retained=[]
    for ring in shapes['ita']:
        b=bounds([ring])
        if area(ring)<0 and b[0]<=old_vatican_center[0]<=b[2] and b[1]<=old_vatican_center[1]<=b[3]:continue
        retained.append(ring)
    shapes['ita']=retained+[list(reversed(correct_vatican))]
    shapes['vat']=[correct_vatican];full_shapes['vat']=[correct_vatican]
    entities['vat']['statusNote']='Vatican footprint corrected from a published geographic outline; Italy uses the matching cutout.'

    order=sorted(entities,key=lambda k:entities[k]['name'].casefold())
    dissolved=[dissolve(shapes[k]) for k in order]
    detailed=simplify_rings(dissolved,12.5)
    simplified=simplify_rings(dissolved,250)
    before=sum(len(r) for rs in dissolved for r in rs);after=sum(len(r) for rs in simplified for r in rs)
    for k,rings in zip(order,simplified):
        e=entities[k];e['d']=svg_path(rings)
        full=full_shapes.get(k,shapes[k]);e['bbox']=bounds(full);e['center']=geometry_center(full)
        p=source_props[k]
        if p.get('LABEL_X') is not None and not e.get('parentId'):
            e['center']=[round((p['LABEL_X']+180)*10,3),round((90-p['LABEL_Y'])*10,3)]
        e['aliases']=list(dict.fromkeys(a for a in e['aliases'] if a and a!=e['name']))
        if 'Saint' in e['name']:
            e['aliases'].extend([e['name'].replace('Saint','St'),e['name'].replace('Saint','St.')])
        if e['iso2'].startswith(('FR-','CN-')):e['iso2']={'guf':'GF','mtq':'MQ','glp':'GP','reu':'RE','myt':'YT','twn':'TW'}.get(k,e['iso2'])
    result={'version':1,'width':3600,'height':1800,'projection':'equirectangular','fillRule':'nonzero',
      'source':{'name':'Natural Earth 1:10m','version':'5.1.1','license':'Public domain','url':'https://www.naturalearthdata.com/',
      'files':source_hashes,'commit':SOURCE_REF,'geometryToleranceDegrees':0.025,'detailToleranceDegrees':0.00125,
      'coordinatePrecisionDegrees':0.0001,'detailFile':'world-detail.json',
      'vaticanCorrection':'https://gist.github.com/jaakla/ea9d93d542b5cff718163f84b07673c3'},
      'coverage':{'countries':sum(e['kind']=='country' and e['playable'] for e in entities.values()),
      'territories':sum(e['kind']=='territory' and e['playable'] for e in entities.values()),
      'autonomousRegions':sum(bool(e.get('parentId')) and e['playable'] for e in entities.values()),
      'nonPlayable':sum(not e['playable'] for e in entities.values()),
      'notes':['Countries include 193 United Nations members, Palestine, Vatican City, Kosovo and Taiwan.',
      'Dependencies, special territories, documented internal autonomies and selected self-administered disputed territories are individually playable.',
      'Autonomy is not a universal legal classification. This is a documented broad inventory, not every provincial government worldwide.',
      'Uninhabited claims, research-only territories, military bases and demilitarized zones are outside the answer pool.',
      'Natural Earth boundaries are generalized for 1:10m display, not cadastral or real-time political boundaries.',
      'Bangsamoro and Papua have the specific geometry limitations recorded in their status notes. Newer and subprovincial Panama comarcas are not separately mapped.']},
      'entities':[entities[k] for k in order]}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    raw=json.dumps(result,ensure_ascii=False,separators=(',',':')).encode()
    args.output.write_bytes(raw)
    detail={'version':1,'paths':{k:svg_path(rings) for k,rings in zip(order,detailed)}}
    detail_raw=json.dumps(detail,separators=(',',':')).encode()
    args.output.with_name('world-detail.json').write_bytes(detail_raw)
    inventory={**result,'entities':[{k:v for k,v in e.items() if k!='d'} for e in result['entities']]}
    args.output.with_name('coverage.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'coverage':result['coverage'],'verticesBefore':before,'verticesAfter':after,'bytes':len(raw),'gzipBytes':len(gzip.compress(raw)),
      'detailBytes':len(detail_raw),'detailGzipBytes':len(gzip.compress(detail_raw))},indent=2))

if __name__=='__main__':main()
