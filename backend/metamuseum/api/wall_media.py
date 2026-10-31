from fastapi import APIRouter, Depends, HTTPException, Request, Response
from starlette.responses import FileResponse, StreamingResponse
from ..auth import require_admin
from ..schemas_wall_design import AssetRead
from ..services import wall_media as service

router = APIRouter(prefix='/api/v1/wall-assets', tags=['wall assets'])

@router.get('', response_model=list[AssetRead], dependencies=[Depends(require_admin)])
def list_assets():
    return [service.dto(doc) for doc in service.collection('assets').find()]

@router.post('', response_model=AssetRead, status_code=201, dependencies=[Depends(require_admin)],
             openapi_extra={'requestBody': {'required': True, 'content': {'multipart/form-data': {'schema': {'type': 'object', 'required': ['file'], 'properties': {'file': {'type': 'string', 'format': 'binary'}}}}}}})
async def upload(request: Request):
    return await service.upload(request)

@router.delete('/{identifier}', status_code=204, dependencies=[Depends(require_admin)])
def delete(identifier: str, request: Request):
    service.delete(identifier, request.app.state.settings)
    return Response(status_code=204)

@router.get('/{identifier}/content')
def content(identifier: str, request: Request):
    doc = service.asset(identifier); path = service.path(request.app.state.settings, identifier)
    if not path.is_file(): raise HTTPException(404, 'asset_content_not_found')
    size = doc['size']; header = request.headers.get('range')
    if header and doc['content_type'].startswith('video/'):
        try:
            unit, span = header.split('=', 1); first, last = span.split('-', 1)
            if unit != 'bytes' or ',' in span: raise ValueError()
            if first:
                start = int(first); end = int(last) if last else size - 1
            else:
                suffix = int(last)
                if suffix <= 0: raise ValueError()
                start = max(0, size - suffix); end = size - 1
            if start < 0 or start >= size or end < start: raise ValueError()
            end = min(end, size - 1)
        except ValueError:
            return Response(status_code=416, headers={'Content-Range': f'bytes */{size}'})
        def chunks():
            with path.open('rb') as f:
                f.seek(start); remaining = end - start + 1
                while remaining:
                    chunk = f.read(min(1024 * 1024, remaining))
                    if not chunk: break
                    remaining -= len(chunk); yield chunk
        return StreamingResponse(chunks(), status_code=206, media_type=doc['content_type'], headers={'Content-Range': f'bytes {start}-{end}/{size}', 'Content-Length': str(end-start+1), 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff'})
    return FileResponse(path, media_type=doc['content_type'], headers={'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff'})
