class Box:
    def __init__(self, position, color="#FFF", size=[1,1,1], opacity=1, rotation=None):
        self.position = position
        self.color = color
        self.size = size
        self.opacity = opacity
        self.rotation = rotation

    def __str__(self):
        return f"""
            <a-box
                position="{self.position}"
                width="{self.size[0]}"
                height="{self.size[1]}"
                depth="{self.size[2]}"
                color="{self.color}"
                opacity="{self.opacity}"
                rotation="{self.rotation}"
            ></a-box>
        """
    
    def __repr__(self):
        return self.__str__()
    
class Sphere:
    def __init__(self, position, radius, color, opacity=1):
        self.position = position
        self.radius = radius
        self.color = color
        self.opacity = opacity

    def __str__(self):
        return f"""
            <a-sphere
                position="{self.position}"
                radius="{self.radius}"
                color="{self.color}"
                opacity="{self.opacity}"
            ></a-sphere>
        """
    
    def __repr__(self):
        return self.__str__()
    

class Cylinder:
    def __init__(self, position, radius, height, color, opacity=1):
        self.position = position
        self.radius = radius
        self.height = height
        self.color = color
        self.opacity = opacity

    def __str__(self):
        return f"""
            <a-cylinder
                position="{self.position}"
                radius="{self.radius}"
                height="{self.height}"
                color="{self.color}"
                opacity="{self.opacity}"
            ></a-cylinder>
        """
    
    def __repr__(self):
        return self.__str__()
    

class Plane:
    def __init__(self, position, size, color, opacity=1, rotation="0 0 0"):
        self.position = position
        self.size = size
        self.color = color
        self.opacity = opacity
        self.rotation = rotation

    def __str__(self):
        return f"""
            <a-plane
                position="{self.position}"
                width="{self.size[0]}"
                height="{self.size[1]}"
                color="{self.color}"
                opacity="{self.opacity}"
                rotation="{self.rotation}"
            ></a-plane>
        """
    
    def __repr__(self):
        return self.__str__()
    

class Sky:
    def __init__(self, color, opacity=1):
        self.color = color
        self.opacity = opacity

    def __str__(self):
        return f"""
            <a-sky
                color="{self.color}"
                opacity="{self.opacity}"
            ></a-sky>
        """
    
    def __repr__(self):
        return self.__str__()
    