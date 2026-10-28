"""Persistent uploaded media; only generated object IDs become filesystem paths."""
import asyncio
import re
from functools import partial
from anyio.to_thread import run_sync
from datetime import datetime, timezone
from pathlib import Path
from bson import ObjectId
from fastapi import HTTPException
from python_multipart import MultipartParser
from python_multipart.exceptions import MultipartParseError
from python_multipart.multipart import parse_options_header
from .wall_designs import collection, locked, utc_now
from .gallery import object_id

upload_lock = asyncio.Lock()

async def offload(fn, *args, **kwargs):
    return await run_sync(partial(fn, *args, **kwargs))

def detect_type(data, claimed):
    signatures = [('image/png', data.startswith(b'\x89PNG\r\n\x1a\n')), ('image/jpeg', data.startswith(b'\xff\xd8\xff')), ('image/gif', data.startswith((b'GIF87a', b'GIF89a'))), ('image/webp', data.startswith(b'RIFF') and data[8:12] == b'WEBP'), ('video/mp4', len(data) >= 12 and data[4:8] == b'ftyp'), ('video/webm', data.startswith(b'\x1a\x45\xdf\xa3'))]
    return next((mime for mime, match in signatures if match and mime == claimed), None)

def dto(doc):
    return {'id': str(doc['_id']), 'name': doc['name'], 'content_type': doc['content_type'], 'size': doc['size'], 'url': f"/api/v1/wall-assets/{doc['_id']}/content", 'created_at': doc['created_at'].isoformat()}

def asset(identifier):
    doc = collection('assets').find_one({'_id': object_id(identifier)})
    if not doc: raise HTTPException(404, 'asset_not_found')
    return doc

def path(settings, identifier):
    return settings.wall_media_root / str(object_id(identifier))

async def upload(request):
    settings = request.app.state.settings
    mime, params = parse_options_header(request.headers.get('content-type', ''))
    if mime != b'multipart/form-data' or not params.get(b'boundary'):
        raise HTTPException(422, 'multipart_required')
    async with upload_lock:
        root = settings.wall_media_root
        await offload(root.mkdir, parents=True, exist_ok=True)
        identifier = ObjectId(); target = root / str(identifier); temporary = root / (str(identifier) + '.partial')
        total = await offload(lambda: sum(item['size'] for item in collection('assets').find({}, {'size': 1})))
        size = 0; head = bytearray(); headers = {}; header_name = bytearray(); header_value = bytearray(); name = None; claimed = None; parts = 0; finished = False
        committed = False
        try:
            output = await offload(temporary.open, 'xb')
            try:
                def part_begin():
                    nonlocal parts
                    parts += 1
                    if parts > 1: raise HTTPException(422, 'one_file_required')
                def header_field(data, start, end): header_name.extend(data[start:end])
                def header_value_cb(data, start, end): header_value.extend(data[start:end])
                def header_end():
                    headers[bytes(header_name).lower()] = bytes(header_value); header_name.clear(); header_value.clear()
                def headers_finished():
                    nonlocal name, claimed
                    disposition, opts = parse_options_header(headers.get(b'content-disposition', b''))
                    if disposition != b'form-data' or opts.get(b'name') != b'file' or b'filename' not in opts: raise HTTPException(422, 'file_required')
                    name = opts[b'filename'].decode('utf8', 'replace').replace('\\', '/').split('/')[-1][:200] or 'upload'
                    claimed = headers.get(b'content-type', b'').decode('ascii', 'ignore').lower()
                def part_data(data, start, end):
                    nonlocal size
                    chunk = data[start:end]; size += len(chunk)
                    if size > settings.wall_media_max_file_bytes or total + size > settings.wall_media_quota_bytes: raise HTTPException(413, 'media_quota_exceeded')
                    if len(head) < 32: head.extend(chunk[:32-len(head)])
                    output.write(chunk)
                def end():
                    nonlocal finished
                    finished = True
                parser = MultipartParser(params[b'boundary'], {'on_part_begin': part_begin, 'on_header_field': header_field, 'on_header_value': header_value_cb, 'on_header_end': header_end, 'on_headers_finished': headers_finished, 'on_part_data': part_data, 'on_end': end})
                received = 0
                async for chunk in request.stream():
                    received += len(chunk)
                    if received > settings.wall_media_max_file_bytes + 1024 * 1024:
                        raise HTTPException(413, 'media_quota_exceeded')
                    await offload(parser.write, chunk)
                await offload(parser.finalize)
            finally:
                await offload(output.close)
            detected = detect_type(head, claimed)
            if not finished or parts != 1 or not size or not detected: raise HTTPException(422, 'invalid_media')
            doc = {'_id': identifier, 'name': name, 'content_type': detected, 'size': size, 'created_at': utc_now()}
            def commit():
                temporary.replace(target)
                collection('assets').insert_one(doc)
            task = asyncio.create_task(offload(commit))
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                await task
                committed = True
                raise
            committed = True
            return dto(doc)
        except BaseException as error:
            await offload(temporary.unlink, missing_ok=True)
            if not committed:
                await offload(target.unlink, missing_ok=True)
            if isinstance(error, MultipartParseError):
                raise HTTPException(422, 'invalid_multipart') from None
            raise

@locked
def delete(identifier, settings):
    identifier = str(object_id(identifier))
    doc = asset(identifier)
    # Older records may contain uppercase hexadecimal references.
    reference = re.compile('^' + identifier + '$', re.IGNORECASE)
    if collection('presets').find_one({'$or': [{'asset_ids': reference}, {'thumbnail_asset_id': reference}]}) or collection('bindings').find_one({'asset_ids': reference}):
        raise HTTPException(409, 'asset_is_referenced')
    collection('assets').delete_one({'_id': doc['_id']})
    path(settings, identifier).unlink(missing_ok=True)


def cleanup(settings):
    root = settings.wall_media_root
    root.mkdir(parents=True, exist_ok=True)
    committed = {str(doc['_id']) for doc in collection('assets').find({}, {'_id': 1})}
    for entry in root.iterdir():
        name = entry.name
        partial = name.endswith('.partial')
        identifier = name[:-8] if partial else name
        if entry.is_file() and ObjectId.is_valid(identifier) and (partial or identifier not in committed):
            entry.unlink(missing_ok=True)
