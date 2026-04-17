"""Seed script to populate mongomock with sample MetaMuseum data."""
import os
import sys

# Add app to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

# Set up mongomock connection BEFORE importing app
USE_MOCK = os.environ.get('MONGODB_MOCK', 'false').lower() == 'true'

if USE_MOCK:
    import mongoengine
    import mongomock
    mongoengine.connect('metamuseum', mongo_client_class=mongomock.MongoClient)
    print("Connected to mongomock")

import os
os.environ['MONGODB_MOCK'] = 'true'  # Ensure app uses mock too

from app import app  # This imports metamuseum but doesn't re-connect if already connected

from metamuseum.models import User
from metamuseum.elements.basic import Room, Wall, Image, GaussianSplat, GLTFmodel

def seed():
    print("Seeding database...")
    
    # Clear existing data
    for cls in [Image, GaussianSplat, GLTFmodel, Wall, Room, User]:
        cls.objects.delete()
    
    # Create sample user
    from flask_bcrypt import generate_password_hash
    admin = User(
        name="Admin",
        email="admin@example.com",
        password=generate_password_hash("admin123"),
        phone="01000000000",
        affiliation="MetaMuseum",
        user_type="admin",
        email_verified=True
    )
    admin.save()
    print("Created admin user: admin@example.com / admin123")
    
    # === Room 1: Demo Room ===
    room1 = Room(
        name="demo_room",
        description="A demo VR room with walls and various content types"
    )
    room1.save()
    
    # Wall 1: Back wall with images
    wall1 = Wall(
        name="demo_wall_images",
        description="Wall with artwork images",
        room=room1,
        position="0 0 -4",
        rotation="0 0 0",
        width=6, height=3, depth=0.2,
        color="#2c3e50",
        images=[]
    )
    wall1.save()
    
    # Images on wall1
    img1 = Image(
        name="matisse_danceI",
        description="Matisse - Dance I artwork",
        wall=wall1,
        position="0 0.5 0",
        position_x=0, position_y=0.5,
        image_url="https://upload.wikimedia.org/wikipedia/en/1/1c/Matisse_-_Dance.jpg",
        width=2, height=1.5
    )
    img1.save()
    
    img2 = Image(
        name="starry_night",
        description="Van Gogh - Starry Night",
        wall=wall1,
        position="-2 0.5 0",
        position_x=-2, position_y=0.5,
        image_url="https://upload.wikimedia.org/wikipedia/commons/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
        width=1.8, height=1.2
    )
    img2.save()
    
    wall1.images = [img1, img2]
    wall1.save()
    
    # Wall 2: Gaussian Splat wall
    wall2 = Wall(
        name="demo_wall_splat",
        description="Wall with 3D gaussian splat",
        room=room1,
        position="4 0 -3",
        rotation="0 -90 0",
        width=4, height=3, depth=0.2,
        color="#1a1a2e",
        splats=[]
    )
    wall2.save()
    
    splat1 = GaussianSplat(
        name="luma_seal_splat",
        description="Luma seal 3D scan",
        wall=wall2,
        position="0 0.5 0",
        position_x=0, position_y=0.5,
        splat_url="https://huggingface.co/quadjr/aframe-gaussian-splatting/resolve/main/luma-seal.splat",
        scale="1 1 1",
        rotation="0 0 0"
    )
    splat1.save()
    wall2.splats = [splat1]
    wall2.save()
    
    # Wall 3: GLTF wall
    wall3 = Wall(
        name="demo_wall_gltf",
        description="Wall with 3D model",
        room=room1,
        position="-4 0 -3",
        rotation="0 90 0",
        width=4, height=3, depth=0.2,
        color="#16213e",
        gltfs=[]
    )
    wall3.save()
    
    gltf1 = GLTFmodel(
        name="dance_model",
        description="Dance animation model",
        wall=wall3,
        position="0 0 0",
        position_x=0, position_y=0,
        position_z=0.5,
        gltf_url="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DanceRevolution/glTF-Binary/DanceRevolution.glb",
        scale="0.5 0.5 0.5",
        default_rotation="0 90 0",
        rotation="0 0 0"
    )
    gltf1.save()
    wall3.gltfs = [gltf1]
    wall3.save()
    
    room1.walls = [wall1, wall2, wall3]
    room1.save()
    
    # === Room 2: Art Gallery ===
    room2 = Room(
        name="art_gallery",
        description="Virtual art gallery with famous paintings"
    )
    room2.save()
    
    wall4 = Wall(
        name="gallery_main",
        description="Main gallery wall",
        room=room2,
        position="0 0 -5",
        rotation="0 0 0",
        width=8, height=4, depth=0.2,
        color="#34495e",
        images=[]
    )
    wall4.save()
    
    artworks = [
        ("girl_pearl", "Girl with a Pearl Earring", "https://upload.wikimedia.org/wikipedia/commons/0/0f/1665_Girl_with_a_Pearl_Earring.jpg", -3, 0.5, 2, 2.5),
        ("great_wave", "The Great Wave off Kanagawa", "https://upload.wikimedia.org/wikipedia/commons/a/a5/Tsunami_by_hokusai_19th_century.jpg", -0.5, 0.5, 2.5, 1.8),
        ("persistence", "The Persistence of Memory", "https://upload.wikimedia.org/wikipedia/en/d/dd/The_Persistence_of_Memory.jpg", 2.5, 0.5, 1.5, 1.2),
    ]
    
    imgs = []
    for name, desc, url, px, py, w, h in artworks:
        img = Image(
            name=name,
            description=desc,
            wall=wall4,
            position=f"{px} {py} 0",
            position_x=px, position_y=py,
            image_url=url,
            width=w, height=h
        )
        img.save()
        imgs.append(img)
    
    wall4.images = imgs
    wall4.save()
    room2.walls = [wall4]
    room2.save()
    
    # === Room 3: Splat Playground ===
    room3 = Room(
        name="splat_playground",
        description="3D Gaussian Splat testing area"
    )
    room3.save()
    
    wall5 = Wall(
        name="splat_wall",
        description="Splat showcase wall",
        room=room3,
        position="0 0 -3",
        rotation="0 0 0",
        width=5, height=3, depth=0.2,
        color="#0f0f23",
        splats=[]
    )
    wall5.save()
    
    splat2 = GaussianSplat(
        name="polycam_seal",
        description="Polycam scanned seal",
        wall=wall5,
        position="0 0.5 0",
        position_x=0, position_y=0.5,
        splat_url="https://huggingface.co/quadjr/aframe-gaussian-splatting/resolve/main/polycam-seal.splat",
        scale="1.5 1.5 1.5",
        rotation="0 0 0"
    )
    splat2.save()
    wall5.splats = [splat2]
    wall5.save()
    room3.walls = [wall5]
    room3.save()
    
    print(f"\nSeeded successfully!")
    print(f"  Rooms: {Room.objects.count()}")
    print(f"  Walls: {Wall.objects.count()}")
    print(f"  Images: {Image.objects.count()}")
    print(f"  Splats: {GaussianSplat.objects.count()}")
    print(f"  GLTFs: {GLTFmodel.objects.count()}")
    print(f"\nRoom URLs:")
    for r in Room.objects.all():
        print(f"  - {r.name}: /room?room_id={r._id}")

if __name__ == "__main__":
    seed()
    
    # Keep app running if called directly
    if '--serve' in sys.argv:
        print("\nStarting server...")
        app.run(host='0.0.0.0', port=8000)