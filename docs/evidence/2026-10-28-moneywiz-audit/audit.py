#!/usr/bin/env python3
"""Aggregate-only MoneyWiz audit; source is never opened by SQLite.

Copy SQLite/WAL/SHM into a private temporary directory, open that copy in
mode=ro, and verify source SHA-256 before/after. No descriptions, notes,
account names, transaction IDs, monetary values or credentials are emitted.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
from zoneinfo import ZoneInfo

EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
ZONE = ZoneInfo('Asia/Shanghai')
SECOND = 1_000_000
MINUTE = 60 * SECOND
SOURCE_FILES = ['ipadMoneyWiz.sqlite', 'ipadMoneyWiz.sqlite-wal', 'ipadMoneyWiz.sqlite-shm']


def fingerprints(directory):
    return {name: {'size': (directory/name).stat().st_size,
                   'sha256': hashlib.sha256((directory/name).read_bytes()).hexdigest()}
            for name in SOURCE_FILES}


def micros(raw):
    # Preserve subsecond evidence; do not truncate to seconds or use float modulo.
    return int((Decimal(str(raw))*SECOND).to_integral_value(rounding=ROUND_HALF_UP))


def zero_second(us):
    return (us // SECOND) % 60 == 0


def collision_summary(rows, divisor):
    groups = defaultdict(list)
    for row in rows:
        groups[(row['account'], row['us']//divisor)].append(row)
    repeated = [group for group in groups.values() if len(group)>1]
    exact_subgroups = sum(sum(n>1 for n in Counter(row['us'] for row in group).values()) for group in repeated)
    created_distinguishable = 0
    for group in repeated:
        for timestamp, count in Counter(row['us'] for row in group).items():
            if count <= 1:
                continue
            members = [r for r in group if r['us']==timestamp]
            created = [r['created'] for r in members]
            if all(v is not None and v>0 for v in created) and len(set(created))==len(created):
                created_distinguishable += 1
    return {
        'repeated_account_buckets': len(repeated),
        'rows_in_repeated_buckets': sum(len(group) for group in repeated),
        'extra_rows_beyond_one_per_bucket': sum(len(group)-1 for group in repeated),
        'largest_bucket_rows': max((len(group) for group in repeated), default=0),
        'all_display_seconds_00_buckets': sum(all(zero_second(r['us']) for r in group) for group in repeated),
        'all_exact_minute_buckets': sum(all(r['us']%MINUTE==0 for r in group) for group in repeated),
        'all_nonzero_display_seconds_buckets': sum(all(not zero_second(r['us']) for r in group) for group in repeated),
        'mixed_zero_and_nonzero_display_seconds_buckets': sum(any(zero_second(r['us']) for r in group) and any(not zero_second(r['us']) for r in group) for group in repeated),
        'buckets_with_multiple_distinct_seconds': sum(len({r['us']//SECOND for r in group})>1 for group in repeated),
        'buckets_with_multiple_distinct_full_timestamps': sum(len({r['us'] for r in group})>1 for group in repeated),
        'buckets_with_an_exact_timestamp_tie': sum(len({r['us'] for r in group})<len(group) for group in repeated),
        'buckets_all_at_identical_full_timestamp': sum(len({r['us'] for r in group})==1 for group in repeated),
        'exact_timestamp_tie_subgroups': exact_subgroups,
        'exact_tie_subgroups_with_distinct_valid_creation_times': created_distinguishable,
    }


def time_summary(rows):
    years = defaultdict(list)
    for row in rows:
        year = (EPOCH+timedelta(microseconds=row['us'])).astimezone(ZONE).year
        years[year].append(row)
    def summarize(values):
        return {'rows':len(values),
                'display_seconds_00':sum(zero_second(r['us']) for r in values),
                'display_seconds_00_percent':round(100*sum(zero_second(r['us']) for r in values)/len(values),4) if values else 0,
                'exact_minute':sum(r['us']%MINUTE==0 for r in values),
                'integer_second':sum(r['us']%SECOND==0 for r in values),
                'fractional_second':sum(r['us']%SECOND!=0 for r in values)}
    stats = summarize(rows)
    stats['per_year_asia_shanghai'] = {str(y): summarize(values) for y,values in sorted(years.items())}
    stats['same_account_minute'] = collision_summary(rows, MINUTE)
    stats['same_account_whole_second'] = collision_summary(rows, SECOND)
    return stats


def aggregate_query(connection, sql, params=()):
    return [dict(row) for row in connection.execute(sql,params)]


def audit(connection):
    entity_rows = connection.execute('SELECT Z_ENT,Z_NAME,Z_SUPER FROM Z_PRIMARYKEY').fetchall()
    entity = {r['Z_ENT']: {'name':r['Z_NAME'],'parent':r['Z_SUPER']} for r in entity_rows}
    def descendants(parent):
        selected={parent}
        while True:
            expanded=selected|{e for e,v in entity.items() if v['parent'] in selected}
            if expanded==selected: return selected
            selected=expanded
    transaction_entities = descendants(42)
    placeholders = ','.join('?' for _ in transaction_entities)
    params = tuple(sorted(transaction_entities))
    where = f'Z_ENT IN ({placeholders})'
    raw_rows = connection.execute(f'''SELECT Z_PK,Z_ENT,ZACCOUNT3,Z9_ACCOUNT3,ZDATE1,ZOBJECTCREATIONDATE,ZSENDERTRANSACTION,ZRECIPIENTTRANSACTION FROM ZSYNCOBJECT WHERE {where}''',params).fetchall()
    rows=[{'id':r['Z_PK'],'entity':r['Z_ENT'],'account':r['ZACCOUNT3'],'account_entity':r['Z9_ACCOUNT3'],
           'us':micros(r['ZDATE1']),'created':micros(r['ZOBJECTCREATIONDATE']) if r['ZOBJECTCREATIONDATE'] is not None else None,
           'sender':r['ZSENDERTRANSACTION'],'recipient':r['ZRECIPIENTTRANSACTION']} for r in raw_rows]
    index={r['id']:r for r in rows}
    accounts={r['Z_PK']:{'entity':r['Z_ENT'],'owner':r['ZUSER']} for r in connection.execute('SELECT Z_PK,Z_ENT,ZUSER FROM ZSYNCOBJECT WHERE Z_ENT IN (10,11,12,13,14,15,16)')}
    transfer_out=[r for r in rows if r['entity']==52]
    valid_pairs=[]
    for row in transfer_out:
        target=index.get(row['recipient'])
        if target and target['entity']==51 and target['sender']==row['id']:
            valid_pairs.append((row,target))
    different_time_pairs=[(a,b) for a,b in valid_pairs if a['us']!=b['us']]
    pair_deltas=[abs(a['us']-b['us']) for a,b in different_time_pairs]
    consumed_recipients={r['id'] for _,r in valid_pairs}
    business_rows=[r for r in rows if r['id'] not in consumed_recipients]
    refund_links=connection.execute('SELECT ZREFUNDTRANSACTION,ZWITHDRAWTRANSACTION FROM ZWITHDRAWREFUNDTRANSACTIONLINK').fetchall()
    refund_rows={r['id']:r for r in rows if r['entity']==49}
    expense_rows={r['id']:r for r in rows if r['entity']==53}
    refund_counts=Counter(r['ZREFUNDTRANSACTION'] for r in refund_links)
    original_counts=Counter(r['ZWITHDRAWTRANSACTION'] for r in refund_links)
    valid_links=[]
    missing_refunds=missing_originals=wrong_refunds=wrong_originals=missing_owners=cross_owner=0
    for link in refund_links:
        refund=index.get(link['ZREFUNDTRANSACTION']); original=index.get(link['ZWITHDRAWTRANSACTION'])
        if not refund: missing_refunds+=1
        elif refund['entity']!=49: wrong_refunds+=1
        if not original: missing_originals+=1
        elif original['entity']!=53: wrong_originals+=1
        if refund and original and refund['entity']==49 and original['entity']==53:
            valid_links.append((refund,original))
            left=accounts.get(refund['account'],{}).get('owner');right=accounts.get(original['account'],{}).get('owner')
            if left is None or right is None: missing_owners+=1
            elif left!=right:cross_owner+=1
    sort_cols=['ZDISPLAYORDER','ZDISPLAYORDER1','ZDISPLAYORDER2','ZDISPLAYORDER3','ZDISPLAYORDER4','ZORDER','ZPOSITION']
    order_population={name:connection.execute(f'SELECT COUNT({name}) FROM ZSYNCOBJECT WHERE {where}',params).fetchone()[0] for name in sort_cols}
    original_fields=aggregate_query(connection,f'''SELECT t.Z_ENT AS entity,COUNT(*) AS rows,
SUM(t.ZORIGINALCURRENCY IS NULL OR t.ZORIGINALCURRENCY='') AS currency_missing,
SUM(t.ZORIGINALCURRENCY=a.ZCURRENCYNAME) AS currency_same_as_account,
SUM(t.ZORIGINALCURRENCY IS NOT NULL AND t.ZORIGINALCURRENCY<>a.ZCURRENCYNAME) AS currency_differs_from_account,
SUM(t.ZORIGINALAMOUNT IS NULL) AS amount_missing,
SUM(t.ZORIGINALAMOUNT=t.ZAMOUNT1) AS amount_same_as_account_transaction,
SUM(t.ZORIGINALAMOUNT<>t.ZAMOUNT1) AS amount_differs_from_account_transaction
FROM ZSYNCOBJECT t JOIN ZSYNCOBJECT a ON a.Z_PK=t.ZACCOUNT3 WHERE t.{where} GROUP BY t.Z_ENT''',params)
    for row in original_fields: row['entity_name']=entity[row.pop('entity')]['name']
    return {
        'sqlite_quick_check':connection.execute('PRAGMA quick_check').fetchone()[0],
        'scope':{
            'physical_transaction_rows':len(rows),
            'entities_with_rows':dict(sorted(Counter(entity[r['entity']]['name'] for r in rows).items())),
            'transaction_account_count':len({r['account'] for r in rows}),
            'account_owner_domains':len({accounts[r['account']]['owner'] for r in rows}),
            'transaction_account_refs_missing':sum(r['account'] not in accounts for r in rows),
            'core_data_account_entity_alias_matches':sum(r['account'] in accounts and r['account_entity']==accounts[r['account']]['entity'] for r in rows),
            'scheduled_handler_rows':connection.execute('SELECT COUNT(*) FROM ZSYNCOBJECT WHERE Z_ENT IN (37,38,39,40)').fetchone()[0],
            'status_values':aggregate_query(connection,f'SELECT ZSTATUS1 AS value,COUNT(*) AS rows FROM ZSYNCOBJECT WHERE {where} GROUP BY 1',params),
            'flags_values':aggregate_query(connection,f'SELECT ZFLAGS1 AS value,COUNT(*) AS rows FROM ZSYNCOBJECT WHERE {where} GROUP BY 1',params),
            'void_cheque_values':aggregate_query(connection,f'SELECT ZVOIDCHEQUE AS value,COUNT(*) AS rows FROM ZSYNCOBJECT WHERE {where} GROUP BY 1',params),
            'limitations':'No explicit deleted/template flag identified for these transaction entities. Status enum meanings were not independently decoded. No active/deleted distinction is invented.'},
        'time_encoding':{
            'occurrence_field':'ZSYNCOBJECT.ZDATE1',
            'reference_epoch':'2001-01-01T00:00:00Z',
            'source_type':'SQLite TIMESTAMP values stored as numeric seconds, some with fractional seconds',
            'interpretation_evidence':'Core Data model and plausible aggregate 2017–2026 dates under Apple reference epoch; Unix interpretation produces 1986–1995.',
            'apple_reference': 'https://developer.apple.com/documentation/foundation/date/timeintervalsincereferencedate-swift.property',
            'precision':'Convert Decimal(str(raw)) seconds to nearest integer microsecond (ROUND_HALF_UP), at most 0.5 microsecond quantization tolerance. No direct floating-point modulo or broad epsilon is used. exact_minute requires canonical microseconds modulo 60,000,000 == 0; display_seconds_00 uses floor(canonical microseconds / 1,000,000) modulo 60 == 0.',
            'raw_decimal_exact_minute_count':sum(Decimal(str(r['ZDATE1'])) % 60 == 0 for r in raw_rows),
            'canonical_exact_minute_disagrees_with_raw_decimal':sum((Decimal(str(r['ZDATE1'])) % 60 == 0) != (micros(r['ZDATE1']) % MINUTE == 0) for r in raw_rows),
            'largest_quantization_error_microseconds':str(max(abs(Decimal(str(r['ZDATE1']))*SECOND-micros(r['ZDATE1'])) for r in raw_rows)),
            'timezone':'Asia/Shanghai for yearly buckets. Its +08:00 offset over the observed range does not change seconds-of-minute or account-minute collision counts.',
            'other_date_fields_population':{name:connection.execute(f'SELECT COUNT({name}) FROM ZSYNCOBJECT WHERE {where}',params).fetchone()[0] for name in ['ZDATE','ZCREATIONDATE','ZCREATIONDATE1','ZOBJECTCREATIONDATE']},
        },
        'physical_time':time_summary(rows),
        'transfer_pairs':{
            'withdraw_rows':len(transfer_out),
            'deposit_rows':sum(r['entity']==51 for r in rows),
            'reciprocal_valid_pairs':len(valid_pairs),
            'same_account_pairs':sum(a['account']==b['account'] for a,b in valid_pairs),
            'different_full_timestamp_pairs':len(different_time_pairs),
            'different_timestamp_absolute_delta_seconds_range':[min(pair_deltas)/SECOND,max(pair_deltas)/SECOND] if pair_deltas else [],
            'different_asia_shanghai_natural_day_pairs':sum((EPOCH+timedelta(microseconds=a['us'])).astimezone(ZONE).date() != (EPOCH+timedelta(microseconds=b['us'])).astimezone(ZONE).date() for a,b in valid_pairs),
            'different_account_minute_pairs':sum(a['us']//MINUTE!=b['us']//MINUTE for a,b in valid_pairs),
            'logical_rows_after_pair_merge':len(business_rows),
            'logical_time_scope':'One representative per reciprocal transfer pair, choosing its withdraw endpoint. Each real account timeline must still retain its own endpoint and its own date.'},
        'logical_representative_time':time_summary(business_rows),
        'refunds':{
            'link_table':'ZWITHDRAWREFUNDTRANSACTIONLINK',
            'refund_field':'ZREFUNDTRANSACTION','original_field':'ZWITHDRAWTRANSACTION',
            'sqlite_declared_foreign_keys':len(connection.execute('PRAGMA foreign_key_list(ZWITHDRAWREFUNDTRANSACTIONLINK)').fetchall()),
            'link_rows':len(refund_links),'refund_entity_rows':len(refund_rows),
            'unique_linked_refunds':len(refund_counts),'unique_linked_original_expenses':len(original_counts),
            'valid_typed_links':len(valid_links),'missing_refund_references':missing_refunds,'missing_original_references':missing_originals,
            'wrong_refund_entity_type':wrong_refunds,'wrong_original_entity_type':wrong_originals,
            'refunds_without_link':sum(i not in refund_counts for i in refund_rows),
            'refunds_with_multiple_links':sum(v>1 for v in refund_counts.values()),
            'duplicate_link_pairs':len(refund_links)-len({(r['ZREFUNDTRANSACTION'],r['ZWITHDRAWTRANSACTION']) for r in refund_links}),
            'original_expenses_with_multiple_refunds':sum(v>1 for v in original_counts.values()),
            'refunds_per_original_distribution':dict(sorted(Counter(original_counts.values()).items())),
            'missing_owner_links':missing_owners,'cross_owner_links':cross_owner,
            'linked_refund_original_different_account':sum(a['account']!=b['account'] for a,b in valid_links),
            'limitations':'Direct transaction-level links are recoverable. This table has no original-split allocation or historical CNY-cost linkage columns, and this audit does not infer either from names or amounts.'},
        'original_currency_fields':original_fields,
        'ordering':{
            'explicit_sort_columns_nonnull_counts':order_population,
            'account_display_sort_settings':aggregate_query(connection,'SELECT ZTRANSACTIONSHISTORYSORTATTR AS attribute,ZTRANSACTIONSHISTORYSORTASC AS ascending,COUNT(*) AS accounts FROM ZSYNCOBJECT WHERE Z_ENT IN(10,11,12,13) GROUP BY 1,2'),
            'unique_transaction_global_ids':connection.execute(f'SELECT COUNT(DISTINCT ZGID) FROM ZSYNCOBJECT WHERE {where}',params).fetchone()[0],
            'unique_creation_timestamps':len({r['created'] for r in rows}),
            'creation_dates_before_reference_epoch':sum(r['created']<0 for r in rows if r['created'] is not None),
            'interpretation':'Z_PK and ZGID provide stable identity, not proven business order. ZOBJECTCREATIONDATE is distinguishable metadata but may reflect creation/import and contains sentinel values; it cannot establish real-world order for same-time records. All 19 account settings say date descending, without a demonstrated tie-break rule.'},
    }


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path(__file__).with_name('aggregate-report.json'))
    args=parser.parse_args()
    source=args.source.resolve()
    before=fingerprints(source)
    with tempfile.TemporaryDirectory(prefix='fine-ledger-moneywiz-audit-',dir='/private/tmp') as temporary:
        copy=Path(temporary)
        for name in SOURCE_FILES:shutil.copy2(source/name,copy/name)
        after_copy=fingerprints(source)
        assert before==after_copy,'Source changed while copying; no audit conclusion produced.'
        connection=sqlite3.connect((copy/SOURCE_FILES[0]).as_uri()+'?mode=ro',uri=True)
        connection.row_factory=sqlite3.Row
        connection.execute('PRAGMA query_only=ON')
        report=audit(connection)
        connection.close()
    after=fingerprints(source)
    assert before==after,'Source changed during audit; no unchanged-source assertion can be made.'
    report['provenance']={'source_fingerprints_before':before,'source_fingerprints_after_copy':after_copy,'source_fingerprints_after_audit':after,'source_unchanged':True,'opened_source_with_sqlite':False,'copied_sqlite_wal_shm':True,'temporary_copy_removed':True}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'output':str(args.output),'source_unchanged':True,'physical_rows':report['scope']['physical_transaction_rows'],'display_seconds_00':report['physical_time']['display_seconds_00'],'exact_minute':report['physical_time']['exact_minute'],'refund_valid_links':report['refunds']['valid_typed_links']},ensure_ascii=False))

if __name__=='__main__':main()
